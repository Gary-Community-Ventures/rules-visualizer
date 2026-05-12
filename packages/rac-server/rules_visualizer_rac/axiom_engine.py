"""Subprocess wrapper around the upstream `axiom-rules-engine` binary.

The binary is vendored under `vendor/axiom-rules-engine/` (built by
`scripts/build-axiom-engine.sh`). This module:

  1. Locates the binary (env var > vendor dir > PATH lookup).
  2. Compiles each loaded RuleSpec composition to a JSON artifact, cached
     per ruleset (so we don't reshell the Rust compiler on every request).
  3. Builds a `CompiledExecutionRequest`, defaults every required input to
     a zero value, layers user overrides on top, pipes JSON to the binary,
     reads JSON back.

Compatible with the engine's 0.1.0 API. The wrapper deliberately stays
shallow — Pydantic-typed wire format passed through as plain dicts so we
don't take a hard dependency on the upstream Python package.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any


# Resolved at first call; None means "look it up again next time".
_binary_path: Path | None = None


def _resolve_binary() -> Path:
    """Locate the axiom-rules-engine binary.

    Order:
      1. `AXIOM_RULES_ENGINE_BIN` env var (absolute path)
      2. Vendored build: `<repo>/vendor/axiom-rules-engine/target/release/axiom-rules-engine`
      3. `axiom-rules-engine` on PATH

    Raises `FileNotFoundError` with the build hint if none work.
    """
    global _binary_path
    if _binary_path is not None and _binary_path.is_file():
        return _binary_path

    env_path = os.environ.get("AXIOM_RULES_ENGINE_BIN")
    if env_path:
        p = Path(env_path)
        if p.is_file():
            _binary_path = p
            return p

    # Vendored — walk up from this file looking for the repo root.
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "vendor" / "axiom-rules-engine" / "target" / "release" / "axiom-rules-engine"
        if candidate.is_file():
            _binary_path = candidate
            return candidate

    # Fall back to PATH lookup.
    found = shutil.which("axiom-rules-engine")
    if found:
        _binary_path = Path(found)
        return _binary_path

    raise FileNotFoundError(
        "axiom-rules-engine binary not found. Run `npm run setup:axiom-engine` "
        "to vendor + build it, or set AXIOM_RULES_ENGINE_BIN to an absolute path."
    )


# --- Compilation cache ---

# ruleset_id → path to compiled artifact. Invalidated by manual API call;
# in dev we'd ideally rebuild when source files change, but RuleSpec content
# is upstream-managed so it rarely moves at dev time.
_artifacts: dict[str, Path] = {}


def compile_program(ruleset_id: str, composition_path: str | Path) -> Path:
    """Compile the RuleSpec composition for `ruleset_id`. Returns the path
    to the resulting JSON artifact (cached after first call)."""
    cached = _artifacts.get(ruleset_id)
    if cached and cached.is_file():
        return cached

    binary = _resolve_binary()
    composition = Path(composition_path)
    artifact = Path(tempfile.gettempdir()) / f"axiom-rs-{ruleset_id}.compiled.json"

    proc = subprocess.run(
        [
            str(binary),
            "compile",
            "--program",
            str(composition),
            "--output",
            str(artifact),
        ],
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        stderr = proc.stderr.strip() or proc.stdout.strip() or "compile failed"
        raise RuntimeError(f"axiom-rules-engine compile failed: {stderr}")

    _artifacts[ruleset_id] = artifact
    return artifact


def invalidate_artifact(ruleset_id: str) -> None:
    """Drop the cached compiled artifact so the next request recompiles."""
    _artifacts.pop(ruleset_id, None)


# --- Execution ---


def _zero_value_for(dtype: str | None) -> dict[str, Any]:
    """Default value to send for an input the user didn't supply. RuleSpec
    dtypes are inferred where we have them; unknowns fall back to decimal 0,
    which the engine will reject if the input is actually a Judgment/Date —
    surfacing a precise "wrong type" error rather than silently passing."""
    d = (dtype or "").lower()
    if d == "judgment" or d == "bool" or d == "boolean":
        return {"kind": "bool", "value": False}
    if d == "date" or d == "day":
        # Sentinel — most rules won't reach here unless the user is asking
        # for a date-dependent query, in which case the override should be
        # in the request.
        return {"kind": "date", "value": "1970-01-01"}
    if d == "text" or d == "string":
        return {"kind": "text", "value": ""}
    # money, integer, rate, decimal, rational → decimal 0
    return {"kind": "decimal", "value": "0"}


# --- Input dtype inference from compiled artifact ---

def _compiled_program_ids(artifact_path: Path) -> tuple[dict[str, str], dict[str, str]]:
    """Returns `({bare_name → durable_id}, {bare_name → entity})` for every
    rule the compiled program knows about. The engine requires queries to
    use durable IDs like `us:statutes/7/2017/a#snap_regular_month_allotment`;
    our visualizer nodes are keyed by bare names. The entity map lets the
    caller pick only outputs evaluable at a given entity scope — querying a
    Person-scoped rule against a Household entity_id makes the engine try
    to look up Person inputs at the wrong entity_id and fail."""
    try:
        with artifact_path.open("r", encoding="utf-8") as f:
            artifact = json.load(f)
    except Exception:
        return {}, {}
    program = artifact.get("program") or {}
    ids: dict[str, str] = {}
    entities: dict[str, str] = {}
    for r in (program.get("derived") or []) + (program.get("parameters") or []):
        if not isinstance(r, dict):
            continue
        name = r.get("name")
        rule_id = r.get("id")
        if name and rule_id:
            ids[name] = rule_id
            entities[name] = r.get("entity") or "Household"
    return ids, entities


def _infer_input_dtypes(artifact_path: Path) -> dict[str, str]:
    """Walk every expression in the compiled program and tag each `input`
    reference with an inferred type by looking at its surrounding context.

    The engine's AST shapes (observed at runtime):
      - `kind: and/or/not` + `items` or `operand`           → bool children
      - `kind: if` + `condition`/`then_expr`/`else_expr`     → condition is bool
      - `kind: comparison` + `left`/`op`/`right`             → bool if op=eq|neq
                                                              with bool literal,
                                                              else numeric
      - `kind: add/sub/mul/div/max/min` + `items`            → numeric children
      - `kind: parameter_lookup` + `index`                   → numeric index
      - `kind: count_related`/`sum_related` + nested children → relational

    Returns `{input_name → "bool" | "decimal"}`. Inputs we can't classify
    fall back to `decimal` (the engine's most-permissive scalar; user can
    override with the right type if needed).
    """
    try:
        with artifact_path.open("r", encoding="utf-8") as f:
            artifact = json.load(f)
    except Exception:
        return {}

    program = artifact.get("program") or {}
    inferred: dict[str, str] = {}

    def record(name: str | None, dtype: str) -> None:
        if not name:
            return
        # Once we've tagged an input as `bool`, don't downgrade — bool
        # ambiguity is much more dangerous than spurious-decimal for
        # numerics, so the first bool-hint wins.
        existing = inferred.get(name)
        if existing == "bool":
            return
        inferred[name] = dtype

    def is_bool_literal(node: Any) -> bool:
        if not isinstance(node, dict):
            return False
        if node.get("kind") == "literal":
            v = node.get("value") or {}
            return v.get("kind") == "bool"
        return False

    def walk(node: Any, expected: str = "unknown") -> None:
        """`expected` is what the parent context wants — bool/decimal/unknown."""
        if not isinstance(node, dict):
            return
        kind = node.get("kind")

        if kind == "input":
            if expected in ("bool", "decimal"):
                record(node.get("name"), expected)
            elif node.get("name") not in inferred:
                inferred[node.get("name")] = "decimal"  # default fallback
            return

        if kind in ("and", "or"):
            for child in node.get("items") or []:
                walk(child, "bool")
            return

        if kind == "not":
            walk(node.get("operand"), "bool")
            return

        if kind == "if":
            walk(node.get("condition"), "bool")
            # then/else inherit our parent's expected type
            walk(node.get("then_expr"), expected)
            walk(node.get("else_expr"), expected)
            return

        if kind == "comparison":
            op = node.get("op")
            left = node.get("left")
            right = node.get("right")
            if op in ("eq", "neq"):
                # If one side is a bool literal, the other side is bool.
                if is_bool_literal(left) or is_bool_literal(right):
                    walk(left, "bool")
                    walk(right, "bool")
                else:
                    walk(left, "decimal")
                    walk(right, "decimal")
            else:
                walk(left, "decimal")
                walk(right, "decimal")
            return

        if kind in ("add", "sub", "mul", "div", "max", "min", "neg", "abs",
                    "ceil", "floor", "round", "sum", "avg"):
            for child in node.get("items") or []:
                walk(child, "decimal")
            for field in ("operand", "left", "right"):
                if field in node:
                    walk(node.get(field), "decimal")
            return

        if kind == "parameter_lookup":
            walk(node.get("index"), "decimal")
            return

        # Generic recursion fallback.
        for value in node.values():
            if isinstance(value, list):
                for v in value:
                    walk(v, "unknown")
            elif isinstance(value, dict):
                walk(value, "unknown")

    for rule in program.get("derived") or []:
        walk(rule.get("expr"), "unknown")

    return inferred


# Per-ruleset cache of fixture overrides keyed by bare input name. RuleSpec
# input slots don't carry explicit dtypes (the engine infers them from
# formula context). Fixtures are the only authoritative source we have for
# correct typed defaults without re-implementing the engine's type checker.
_fixture_overrides: dict[tuple[str, frozenset[str]], dict[str, dict[str, Any]]] = {}


def _collect_input_references(artifact_path: Path) -> dict[str, tuple[str, str]]:
    """Walk every expression in the compiled program and collect every
    `{kind: input, name: X}` reference. Returns `{bare_input_name →
    (sample_durable_id, entity)}`.

    The engine validates each input record via `PublicReference::parse`,
    which requires a `<module>:<path>#input.<bare>` shape on the wire — but
    looks up by bare name internally. So we just need *some* valid durable
    form per input, which we can build from any rule that references it
    (its containing rule's `id` gives us a module:path prefix).

    Entity scope is inferred from the consuming rule: every derived rule has
    an `entity` field, and an input referenced inside that rule's expr is
    scoped to that entity. We verified on the SNAP program that every input
    is used at exactly one entity scope across all consumers — clean
    partition between Household and Person inputs.
    """
    try:
        with artifact_path.open("r", encoding="utf-8") as f:
            artifact = json.load(f)
    except Exception:
        return {}

    inputs: dict[str, tuple[str, str]] = {}

    def visit(node: Any, current_module: str, current_entity: str) -> None:
        if not isinstance(node, dict):
            return
        if node.get("kind") == "input":
            name = node.get("name")
            if name and name not in inputs and current_module:
                inputs[name] = (f"{current_module}#input.{name}", current_entity)
            return
        for value in node.values():
            if isinstance(value, list):
                for v in value:
                    visit(v, current_module, current_entity)
            elif isinstance(value, dict):
                visit(value, current_module, current_entity)

    program = artifact.get("program") or {}
    for rule in program.get("derived") or []:
        rule_id = rule.get("id") or ""
        module = rule_id.rsplit("#", 1)[0] if "#" in rule_id else ""
        entity = rule.get("entity") or "Household"
        visit(rule.get("expr"), module, entity)

    return inputs


def _load_fixture_overrides(
    composition_path: Path, compiled_rule_names: set[str]
) -> dict[str, dict[str, Any]]:
    """Walk every `.test.yaml` reachable from the composition (its own plus
    every transitive import) and return `{bare_input_name → ScalarValue}`
    of the first-seen fixture value per name. Used as type hints + sensible
    starting defaults for the engine.

    Both top-level inputs and inputs nested under `#relation.<rel>:` member
    blocks contribute — bare names are unique across entity scopes (verified
    on SNAP) so the consumer can re-route Person-scoped values to a Person
    member without ambiguity.

    Filter: bare names matching actual derived/parameter rules in the
    compiled program are DROPPED. Module test fixtures stub derived deps as
    inputs (a unit-test isolation pattern); in the composed program those
    names belong to real rules and can't be set as inputs.
    """
    cache_key = (str(composition_path), frozenset(compiled_rule_names))
    cached = _fixture_overrides.get(cache_key)
    if cached is not None:
        return cached

    import yaml

    overrides: dict[str, dict[str, Any]] = {}
    rulespec_root = _find_rulespec_root_from(composition_path)

    def module_id_to_path(module_id: str) -> Path | None:
        if rulespec_root is None or ":" not in module_id:
            return None
        prefix, rel = module_id.split(":", 1)
        for juris_dir in (f"rulespec-{prefix}", prefix):
            candidate = rulespec_root / juris_dir / f"{rel}.yaml"
            if candidate.is_file():
                return candidate
        return None

    to_visit: list[Path] = [composition_path]
    visited: set[Path] = set()
    while to_visit:
        path = to_visit.pop(0)
        if path in visited:
            continue
        visited.add(path)
        try:
            with path.open("r", encoding="utf-8") as f:
                doc = yaml.safe_load(f) or {}
        except Exception:
            doc = {}
        for imp in doc.get("imports") or []:
            ip = module_id_to_path(imp)
            if ip and ip not in visited:
                to_visit.append(ip)
        test_path = path.with_name(path.stem + ".test.yaml")
        if not test_path.is_file():
            continue
        try:
            with test_path.open("r", encoding="utf-8") as f:
                cases = yaml.safe_load(f) or []
        except Exception:
            continue
        if not isinstance(cases, list):
            continue
        def absorb_scalar(full_name: str, raw_value: Any) -> None:
            bare = (
                full_name.rsplit("#input.", 1)[1]
                if "#input." in full_name
                else full_name.rsplit("#", 1)[-1]
            )
            if bare in compiled_rule_names:
                return
            if bare not in overrides:
                overrides[bare] = _user_value(raw_value)

        for case in cases:
            raw_inputs = (case or {}).get("input") or {}
            for full_name, raw_value in raw_inputs.items():
                if "#relation." in full_name:
                    # Relation blocks carry per-member input lists; pull
                    # those out so Person-scoped fixture values seed the
                    # member default just like top-level inputs seed the
                    # household.
                    if isinstance(raw_value, list):
                        for member in raw_value:
                            if isinstance(member, dict):
                                for k, v in member.items():
                                    if "#input." in k:
                                        absorb_scalar(k, v)
                    continue
                absorb_scalar(full_name, raw_value)

    _fixture_overrides[cache_key] = overrides
    return overrides


def _find_rulespec_root_from(composition_path: Path) -> Path | None:
    """Walk up from a composition file to find the rulespec content root
    (directory containing `rulespec-<jurisdiction>/` subdirs)."""
    for parent in composition_path.parents:
        try:
            children = {p.name for p in parent.iterdir() if p.is_dir()}
        except (OSError, PermissionError):
            continue
        if any(c.startswith("rulespec-") for c in children):
            return parent
    return None


def _user_value(raw: Any) -> dict[str, Any]:
    """Coerce a user-supplied Python value into the engine's ScalarValue
    shape. We don't know the target dtype, so infer from the Python type."""
    if isinstance(raw, bool):
        return {"kind": "bool", "value": raw}
    if isinstance(raw, int):
        # Use decimal so the engine accepts in any numeric column.
        return {"kind": "decimal", "value": str(raw)}
    if isinstance(raw, float):
        return {"kind": "decimal", "value": str(raw)}
    if isinstance(raw, str):
        # Heuristic: if it looks like a date, send as date.
        if len(raw) == 10 and raw[4] == "-" and raw[7] == "-":
            return {"kind": "date", "value": raw}
        return {"kind": "text", "value": raw}
    # Fall through — let the engine reject so we get a clear error.
    return {"kind": "text", "value": str(raw)}


def execute(
    ruleset_id: str,
    composition_path: str | Path,
    model: dict,
    *,
    user_inputs: dict[str, Any] | None = None,
    entities: dict[str, list[dict[str, Any]]] | None = None,
    query_outputs: list[str] | None = None,
    entity_id: str = "h1",
    period_start: str = "2026-01-01",
    period_end: str = "2026-01-31",
) -> dict[str, Any]:
    """Execute the ruleset against user-supplied inputs.

    Inputs that weren't supplied are defaulted to zero values inferred from
    each Model input node's `content.dtype` (when available — RuleSpec
    doesn't always declare dtypes on inputs since they're inferred from
    formula context). The engine fails fast on the first input it actually
    needs but doesn't get; that error is propagated back.

    Returns a dict of {nodeId: {value}} matching the existing /execute
    response shape so the frontend doesn't have to change.
    """
    binary = _resolve_binary()
    composition = Path(composition_path)
    artifact = compile_program(ruleset_id, composition)

    user_inputs = user_inputs or {}
    entities = entities or {}

    # Build {bare_name → durable_id} for every compiled rule. We need this
    # to address queried outputs (engine requires durable IDs for queries
    # in composed programs) and to filter fixture inputs that conflict with
    # real derived rules (a module test stubs its derived deps as inputs
    # for isolation; the composed program rejects that).
    compiled_ids, compiled_entities = _compiled_program_ids(artifact)
    compiled_rule_names = set(compiled_ids.keys())

    # Enumerate every input slot the program actually references — this is
    # the canonical "what does this program need" list (not the test
    # fixtures, which only cover paths exercised by unit tests).
    input_refs = _collect_input_references(artifact)

    # Fixture values give us correct dtypes (bool vs decimal) and any
    # meaningful starting values upstream maintainers encoded.
    fixture_overrides = _load_fixture_overrides(composition, compiled_rule_names)

    # AST inference as a last-resort dtype hint for inputs no fixture
    # touched (e.g. typo'd names like `income_received_in_past_30_days`).
    inferred_dtypes = _infer_input_dtypes(artifact)

    nodes: dict[str, dict] = model.get("nodes") or {}
    input_records: list[dict[str, Any]] = []
    # Wide interval — engine just needs it to cover the query period.
    default_interval = {"start": "1970-01-01", "end": "2099-12-31"}

    # Seed every input the program references. Precedence per input:
    #   1. user-supplied value (by bare name)
    #   2. fixture value (gives meaningful default + correct dtype)
    #   3. zero-typed value using inferred dtype, falling back to decimal
    #
    # MVP entity model: one Household ("h1") with one Person member
    # ("person-1") for any Person-scoped inputs. The engine's eligibility
    # gates (snap_ssn_eligible, snap_residency_citizenship_eligible, etc.)
    # are computed as count_where(member_of_household, …) > 0, so we need
    # at least one member with the right person-level flags set for the
    # household to qualify. Multi-member households are TODO — would need
    # the profile/UI to express a list of members.
    person_id = "person-1"
    has_person_input = False
    for bare, (durable, entity) in input_refs.items():
        if bare in user_inputs:
            value = _user_value(user_inputs[bare])
        elif bare in fixture_overrides:
            value = fixture_overrides[bare]
        else:
            value = _zero_value_for(inferred_dtypes.get(bare))
        if entity == "Person":
            has_person_input = True
            target_entity_id = person_id
        else:
            target_entity_id = entity_id
        input_records.append(
            {
                "name": durable,
                "entity": entity,
                "entity_id": target_entity_id,
                "interval": default_interval,
                "value": value,
            }
        )

    # The engine's `count_related`/`sum_related` over `member_of_household`
    # needs an actual relation row tying the Person to the Household. Slot
    # ordering: arity-2 tuples are [Person, Household] per upstream
    # convention (related_slot=0 is Person, current_slot=1 is Household in
    # the compiled `count_related` expressions we observed).
    relation_records: list[dict[str, Any]] = []
    if has_person_input:
        relation_records.append(
            {
                "name": "member_of_household",
                "tuple": [person_id, entity_id],
                "interval": default_interval,
            }
        )

    # Default the query to every computed leaf (computed nodes nobody else
    # depends on) intersected with what the compiled program supports.
    # If the caller passed `query_outputs` we use that, again filtered.
    if query_outputs is None:
        incoming: dict[str, int] = {nid: 0 for nid in nodes}
        for n in nodes.values():
            for dep in n.get("dependencies") or []:
                if dep in incoming:
                    incoming[dep] += 1
        candidates = [
            nid
            for nid, n in nodes.items()
            if (n.get("content") or {}).get("role") == "computed"
            and incoming.get(nid, 0) == 0
        ]
        if not candidates:
            candidates = [
                nid
                for nid, n in nodes.items()
                if (n.get("content") or {}).get("role") == "computed"
            ]
        query_bare = [n for n in candidates if n in compiled_ids]
    else:
        query_bare = [n for n in query_outputs if n in compiled_ids]

    # The engine evaluates each queried output at the query's entity_id. A
    # Person-scoped output evaluated at a Household id makes it try to find
    # Person inputs at the wrong scope (engine errors with "missing input X
    # for entity h1"). Restrict the query to Household-scoped rules here;
    # Person-scoped outputs are still surfaced via the response trace,
    # which carries every dependency the engine evaluated en route.
    query_bare = [n for n in query_bare if compiled_entities.get(n) == "Household"]

    # If our intersection came up empty, just query the canonical answer.
    if not query_bare and "snap_allotment" in compiled_ids:
        query_bare = ["snap_allotment"]

    # The engine wants durable IDs. Track the reverse mapping so we can
    # convert response keys back to bare names for the frontend.
    query_outputs = [compiled_ids[n] for n in query_bare]
    id_to_bare = {compiled_ids[n]: n for n in query_bare}

    request = {
        "mode": "explain",
        "dataset": {
            "inputs": input_records,
            "relations": relation_records,
        },
        "queries": [
            {
                "entity_id": entity_id,
                "period": {
                    "period_kind": "month",
                    "start": period_start,
                    "end": period_end,
                },
                "outputs": query_outputs,
            }
        ],
    }

    if os.environ.get("AXIOM_DEBUG"):
        Path("/tmp/axiom-last-request.json").write_text(json.dumps(request, indent=2))
    proc = subprocess.run(
        [str(binary), "run-compiled", "--artifact", str(artifact)],
        input=json.dumps(request),
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        stderr = proc.stderr.strip() or proc.stdout.strip() or "execution failed"
        raise RuntimeError(stderr)

    response = json.loads(proc.stdout)

    # Flatten the engine's response into {nodeId: {value}} matching the
    # existing /execute contract. The trace also has values; we use it to
    # back-fill the rest of the graph so the visualizer can show every
    # computed value, not just the queried ones. Response keys may be
    # either bare names (trace) or durable IDs (outputs) — strip the prefix.
    def to_bare(key: str) -> str:
        if "#" in key:
            return key.rsplit("#", 1)[1]
        return key

    results: dict[str, dict[str, Any]] = {}
    for entity_result in response.get("results") or []:
        outputs = entity_result.get("outputs") or {}
        trace = entity_result.get("trace") or {}
        # Outputs win on conflict.
        for key, payload in {**trace, **outputs}.items():
            bare = id_to_bare.get(key) or to_bare(key)
            if bare not in nodes:
                continue
            results[bare] = {"value": _value_from_payload(payload)}

    return results


def _value_from_payload(payload: dict[str, Any]) -> Any:
    """Extract a Python-friendly value from an engine output/trace entry."""
    if not isinstance(payload, dict):
        return payload
    kind = payload.get("kind")
    if kind == "judgment":
        return payload.get("outcome") == "holds"
    if kind == "scalar":
        v = payload.get("value") or {}
        return _scalar_value(v)
    if kind in ("bool", "decimal", "text", "date", "integer"):
        return _scalar_value(payload)
    return payload


def _scalar_value(v: dict[str, Any]) -> Any:
    """Unwrap the engine's ScalarValue envelope into a plain Python value."""
    kind = v.get("kind")
    raw = v.get("value")
    if kind == "bool":
        return bool(raw)
    if kind == "integer":
        return int(raw) if raw is not None else None
    if kind == "decimal":
        # Keep as string to preserve precision; frontend can format.
        return raw
    return raw
