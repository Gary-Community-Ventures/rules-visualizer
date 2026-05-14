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

# Sentinel distinct from None — None is a legitimate user-supplied value
# (e.g. a profile that wants to set a Person field to "no value yet").
_UNSET: Any = object()


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

def _compiled_program_ids(
    artifact_path: Path,
) -> tuple[dict[str, str], dict[str, str | None]]:
    """Returns `({bare_name → durable_id}, {bare_name → entity_or_None})`
    for every rule the compiled program knows about. The engine requires
    queries to use durable IDs like `us:statutes/7/2017/a#snap_regular_month_allotment`;
    our visualizer nodes are keyed by bare names. The entity map lets the
    caller pick only outputs evaluable at a given entity scope — querying
    a collection-scoped rule against the root entity_id makes the engine
    try to look up collection inputs at the wrong scope and fail.

    Rules with no `entity:` field map to `None` (not a fallback entity
    string), so downstream filters can match unentitled rules against any
    chosen root entity rather than incorrectly tagging them as a specific
    one. Whichever entity is conceptually the root is decided by the
    topology classifier, not assumed here.
    """
    try:
        with artifact_path.open("r", encoding="utf-8") as f:
            artifact = json.load(f)
    except Exception:
        return {}, {}
    program = artifact.get("program") or {}
    ids: dict[str, str] = {}
    entities: dict[str, str | None] = {}
    for r in (program.get("derived") or []) + (program.get("parameters") or []):
        if not isinstance(r, dict):
            continue
        name = r.get("name")
        rule_id = r.get("id")
        if name and rule_id:
            ids[name] = rule_id
            entities[name] = r.get("entity") or None
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


def _classify_topology(artifact_path: Path) -> dict[str, Any]:
    """Discover the program's entity/relation topology from the compiled
    artifact. The engine treats entity names as opaque strings; this
    function reconstructs the structural roles they play so the wrapper
    doesn't have to hardcode anything program-specific.

    Returns:
        {
            'entity_types': {<entity_name>, ...},   # every entity_name seen on a derived rule
            'relation_slots': {(rel_name, slot_idx): entity_name},
            'root_entity': str | None,              # entity treated as the query target
            'collection_entities': {<entity_name>, ...}, # entities that appear as a related slot
            'relation_links': {(parent_entity, child_entity): [(rel_name, parent_slot, child_slot), ...]},
        }

    `relation_slots` is built by walking every `count_related`/`sum_related`:
    that node says "I'm evaluated in entity X (= consuming rule's entity) at
    slot `current_slot` of relation R." So R[current_slot] = X. The
    related-side slot's entity is inferred from any `kind: derived` reference
    inside the `where`/`value` subtree (those derived rules carry explicit
    `entity` declarations and are evaluated at the related entity).

    The "root" is whichever entity is treated as the query container — it
    appears as a current_slot somewhere and never as a related_slot. Anything
    that does appear as a related_slot is a "collection entity" and gets
    member fan-out treatment at execute time. Entities that are neither
    (e.g. SnapUnit in SNAP) just float along without special handling.
    """
    try:
        with artifact_path.open("r", encoding="utf-8") as f:
            artifact = json.load(f)
    except Exception:
        return {
            "entity_types": set(),
            "relation_slots": {},
            "root_entity": None,
            "collection_entities": set(),
            "relation_links": {},
        }

    program = artifact.get("program") or {}

    # Step 1: all entity types appearing on derived rules.
    derived_rules = program.get("derived") or []
    entity_types: set[str] = set()
    derived_entity: dict[str, str] = {}  # bare_name → entity
    for r in derived_rules:
        e = r.get("entity")
        if e:
            entity_types.add(e)
            if r.get("name"):
                derived_entity[r["name"]] = e

    # Step 2: walk count_related/sum_related to learn relation slot entities.
    relation_slots: dict[tuple[str, int], str] = {}
    current_slots_seen: set[str] = set()
    related_slots_seen: set[str] = set()

    def first_derived_entity(node: Any) -> str | None:
        """Find the first `{kind: derived, name: X}` reference in a subtree
        and return X's declared entity (if known)."""
        if not isinstance(node, dict):
            return None
        if node.get("kind") == "derived":
            return derived_entity.get(node.get("name") or "")
        for value in node.values():
            if isinstance(value, list):
                for x in value:
                    found = first_derived_entity(x)
                    if found:
                        return found
            elif isinstance(value, dict):
                found = first_derived_entity(value)
                if found:
                    return found
        return None

    def walk_for_relations(node: Any, outer_entity: str) -> None:
        if not isinstance(node, dict):
            return
        kind = node.get("kind")
        if kind in ("count_related", "sum_related"):
            rel = node.get("relation")
            cs = node.get("current_slot")
            rs = node.get("related_slot")
            if isinstance(rel, str):
                if isinstance(cs, int) and outer_entity:
                    # First observation wins; conflicts are content bugs.
                    relation_slots.setdefault((rel, cs), outer_entity)
                    current_slots_seen.add(outer_entity)
                if isinstance(rs, int):
                    # Try to learn the related slot's entity from the
                    # `where`/`value` subtree. A `kind: derived` ref inside
                    # carries the canonical entity tag.
                    inferred = first_derived_entity(node.get("where")) or \
                        first_derived_entity(node.get("value"))
                    if inferred:
                        relation_slots.setdefault((rel, rs), inferred)
                        related_slots_seen.add(inferred)
                # Descend into where/value subtrees with the related entity
                # context (or fall back to outer if we couldn't infer).
                inner_entity = relation_slots.get((rel, rs)) if isinstance(rs, int) else None
                for field in ("where", "value"):
                    child = node.get(field)
                    if child is not None:
                        walk_for_relations(child, inner_entity or outer_entity)
            return
        for value in node.values():
            if isinstance(value, list):
                for x in value:
                    walk_for_relations(x, outer_entity)
            elif isinstance(value, dict):
                walk_for_relations(value, outer_entity)

    for r in derived_rules:
        walk_for_relations(r.get("expr"), r.get("entity") or "")

    # Step 2b: unify equivalent relation names. A composition often carries
    # both a bare name (`member_of_household`) and a durable form
    # (`us:statutes/7/2012/j#relation.member_of_household`) for the same
    # logical relation; the engine treats them as distinct keys but the
    # compiler emits both. Two relations are equivalent if one's name ends
    # with `#relation.<bare>` where `<bare>` is the other's full name.
    # Merging their slot maps lets us fill in slots that only one form
    # happened to observe.
    rel_names_all = {rel for (rel, _) in relation_slots}
    equivalents: dict[str, set[str]] = {n: {n} for n in rel_names_all}
    for n in rel_names_all:
        bare = n
        if "#relation." in n:
            bare = n.rsplit("#relation.", 1)[1]
        for m in rel_names_all:
            if m == n:
                continue
            m_bare = m.rsplit("#relation.", 1)[1] if "#relation." in m else m
            if bare == m or m_bare == n or bare == m_bare:
                equivalents[n].add(m)
                equivalents.setdefault(m, set()).add(n)
    # Apply union: every group of equivalent names sees the union of all
    # observed slot entities. Conflicting entities in the same slot get
    # the first-seen value (consistent with the rest of this function).
    for name, group in equivalents.items():
        if len(group) <= 1:
            continue
        merged: dict[int, str] = {}
        for member in group:
            for (rel, slot), entity in relation_slots.items():
                if rel == member:
                    merged.setdefault(slot, entity)
        for member in group:
            for slot, entity in merged.items():
                relation_slots.setdefault((member, slot), entity)

    # Step 3: decide root + collection entities.
    # Root is an entity that hosts count_related (current_slot) but is never
    # iterated *over* (never a related_slot). Collection entities are the
    # related-slot ones. If we can't find a unique root, fall back to the
    # entity with the most derived rules — that's almost always the right
    # answer for benefit-determination programs.
    collection_entities = set(related_slots_seen)
    root_candidates = current_slots_seen - related_slots_seen
    if len(root_candidates) == 1:
        root_entity = next(iter(root_candidates))
    else:
        # Fallback: most-frequent entity on derived rules.
        if entity_types:
            counts: dict[str, int] = {}
            for r in derived_rules:
                e = r.get("entity")
                if e:
                    counts[e] = counts.get(e, 0) + 1
            root_entity = max(counts, key=counts.get) if counts else None
        else:
            root_entity = None

    # Step 4: relation_links lets the wrapper figure out which relations
    # tie a collection entity back to the root (or any parent entity).
    # Keyed by (parent_entity, child_entity) → list of (rel_name, parent_slot, child_slot).
    relation_links: dict[tuple[str, str], list[tuple[str, int, int]]] = {}
    rel_names = {rel for (rel, _) in relation_slots}
    for rel in rel_names:
        # Find every slot of this relation that we have an entity for.
        slot_entities = {
            slot: relation_slots[(rel, slot)]
            for (r, slot) in relation_slots if r == rel
        }
        # For each pair (parent_slot, child_slot), record the link.
        for p_slot, p_ent in slot_entities.items():
            for c_slot, c_ent in slot_entities.items():
                if p_slot == c_slot or p_ent == c_ent:
                    continue
                relation_links.setdefault((p_ent, c_ent), []).append(
                    (rel, p_slot, c_slot)
                )

    return {
        "entity_types": entity_types,
        "relation_slots": relation_slots,
        "root_entity": root_entity,
        "collection_entities": collection_entities,
        "relation_links": relation_links,
    }


def _collect_relation_names(artifact_path: Path) -> list[str]:
    """Every distinct `count_related.relation` / `sum_related.relation`
    name. Used as a defensive fallback when no per-link topology is
    available; the generalized path uses `_classify_topology`."""
    topo = _classify_topology(artifact_path)
    rels = {rel for (rel, _) in topo.get("relation_slots", {})}
    return sorted(rels)


def _collect_input_references(
    artifact_path: Path, topology: dict[str, Any] | None = None
) -> dict[str, tuple[str, str]]:
    """Walk every expression in the compiled program and collect every
    `{kind: input, name: X}` reference. Returns `{bare_input_name →
    (sample_durable_id, entity)}`.

    The engine validates each input record via `PublicReference::parse`,
    which requires a `<module>:<path>#input.<bare>` shape on the wire — but
    looks up by bare name internally. So we just need *some* valid durable
    form per input, which we can build from any rule that references it
    (its containing rule's `id` gives us a module:path prefix).

    Entity scope is inferred from context:
      - Default: the consuming derived rule's entity.
      - Inside `count_related`/`sum_related`: switch to the entity at the
        relation's related slot (looked up in `topology.relation_slots`).

    Topology is discovered once per artifact via `_classify_topology`; no
    program-specific entity names are hardcoded.
    """
    try:
        with artifact_path.open("r", encoding="utf-8") as f:
            artifact = json.load(f)
    except Exception:
        return {}

    topo = topology or _classify_topology(artifact_path)
    relation_slots: dict[tuple[str, int], str] = topo.get("relation_slots", {})

    inputs: dict[str, tuple[str, str]] = {}

    def visit(node: Any, current_module: str, current_entity: str) -> None:
        if not isinstance(node, dict):
            return
        kind = node.get("kind")
        if kind == "input":
            name = node.get("name")
            if name and name not in inputs and current_module:
                inputs[name] = (f"{current_module}#input.{name}", current_entity)
            return
        if kind in ("count_related", "sum_related"):
            rel = node.get("relation")
            rs = node.get("related_slot")
            related_entity = current_entity
            if isinstance(rel, str) and isinstance(rs, int):
                related_entity = relation_slots.get((rel, rs), current_entity)
            for field in ("where", "value"):
                child = node.get(field)
                if child is not None:
                    visit(child, current_module, related_entity)
            return
        for value in node.values():
            if isinstance(value, list):
                for v in value:
                    visit(v, current_module, current_entity)
            elif isinstance(value, dict):
                visit(value, current_module, current_entity)

    program = artifact.get("program") or {}
    root_entity = topo.get("root_entity")
    for rule in program.get("derived") or []:
        rule_id = rule.get("id") or ""
        module = rule_id.rsplit("#", 1)[0] if "#" in rule_id else ""
        # An unentitled rule inherits the discovered root entity. If even
        # the topology couldn't determine a root (degenerate artifact),
        # we leave the entity unset rather than guessing a name — the
        # downstream input tagger will treat it as un-bucketed.
        entity = rule.get("entity") or root_entity or ""
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

    # Discover the program's entity/relation topology — what's the root
    # entity, which entities are collection-scoped, how do relations link
    # them. Replaces every program-specific assumption (Person/Household,
    # member_of_household) with values read from the artifact.
    topology = _classify_topology(artifact)
    root_entity: str | None = topology.get("root_entity")
    collection_entities: set[str] = topology.get("collection_entities") or set()
    relation_links: dict[tuple[str, str], list[tuple[str, int, int]]] = (
        topology.get("relation_links") or {}
    )
    # Label sent on root-scope InputRecord (the engine wants a non-empty
    # string but never inspects the value — it's metadata for tooling).
    # We need a real string here even when topology can't determine a
    # root (extremely degenerate program); fall back to empty string,
    # which the engine accepts. Importantly we do NOT default to
    # "Household" because that's only correct for SNAP-shaped programs.
    root_entity_label: str = root_entity or ""

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
    input_refs = _collect_input_references(artifact, topology)

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

    # Partition input slots by entity. Anything tagged with a collection
    # entity (e.g. Person) gets per-row fan-out; everything else is a
    # singleton at the root entity_id. Inputs with an unrecognized entity
    # (or none) flow to the root by default — same as the engine, which
    # has no schema for entities.
    inputs_by_entity: dict[str, list[tuple[str, str]]] = {}
    for bare, (durable, entity) in input_refs.items():
        bucket = entity if entity in collection_entities else root_entity
        inputs_by_entity.setdefault(bucket, []).append((bare, durable))

    def value_for(bare: str, override: Any = _UNSET) -> dict[str, Any]:
        """Precedence: row-level override (if not _UNSET) > top-level
        user_inputs > fixture default > typed zero."""
        if override is not _UNSET:
            return _user_value(override)
        if bare in user_inputs:
            return _user_value(user_inputs[bare])
        if bare in fixture_overrides:
            return fixture_overrides[bare]
        return _zero_value_for(inferred_dtypes.get(bare))

    # Root-entity inputs go in as singletons.
    for bare, durable in inputs_by_entity.get(root_entity, []):
        input_records.append(
            {
                "name": durable,
                "entity": root_entity_label,
                "entity_id": entity_id,
                "interval": default_interval,
                "value": value_for(bare),
            }
        )

    # Member fan-out, one bucket per collection entity. The wire format
    # mirrors factgraph's: `entities = {<collection_entity_name>: [{row}, ...]}`.
    # Each row's per-input overrides win; otherwise fall back through
    # user_inputs → fixture → typed zero. If the caller passed no rows for
    # a collection that has inputs, we auto-mint one default row so any
    # `count_related(..., where) > 0` gates can still hit someone — keeps
    # single-member flat profiles producing realistic results.
    relation_records: list[dict[str, Any]] = []
    # Per-collection state we'll need below for the multi-query response
    # flattening and per-member input echoing.
    member_order_by_collection: dict[str, list[str]] = {}
    member_id_to_collection: dict[str, str] = {}
    member_input_scalars: dict[str, dict[str, dict[str, Any]]] = {}
    for collection in sorted(collection_entities):
        member_slots = inputs_by_entity.get(collection, [])
        rows: list[dict[str, Any]] = list(entities.get(collection) or [])
        if not rows and member_slots:
            rows = [{}]
        if not rows:
            continue

        # Slot ordering for relations that link this collection back to
        # the root: ask the topology where the root and the collection
        # sit, and write the tuple positionally. The artifact may carry
        # multiple equivalent names for the same logical relation (bare +
        # durable form); we emit a row under each because the engine
        # indexes by exact-name match.
        links = relation_links.get((root_entity, collection)) or []
        # Fallback if the topology couldn't infer this link: use whatever
        # relation names are in the artifact and assume `[child, parent]`.
        fallback_relations: list[str] = []
        if not links:
            fallback_relations = sorted({
                rel for (rel, _) in topology.get("relation_slots", {})
            })

        member_prefix = collection.lower().rstrip("s")
        member_order_by_collection[collection] = []
        for idx, row in enumerate(rows, start=1):
            member_id = str(row.get("id") or f"{member_prefix}-{idx}")
            member_order_by_collection[collection].append(member_id)
            member_id_to_collection[member_id] = collection
            per_member_values: dict[str, dict[str, Any]] = {}
            for bare, durable in member_slots:
                override = row.get(bare, _UNSET)
                v = value_for(bare, override)
                per_member_values[bare] = v
                input_records.append(
                    {
                        "name": durable,
                        "entity": collection,
                        "entity_id": member_id,
                        "interval": default_interval,
                        "value": v,
                    }
                )
            member_input_scalars[member_id] = per_member_values
            # Duplicate every root-entity input at this member's entity_id
            # too. Person-scoped derived rules can transitively reference
            # Household-scoped inputs (e.g. `household_size > 4`); the
            # engine looks those up at whatever entity_id is the current
            # evaluation context, so without a copy at the member's id
            # they'd fail with "missing input X for entity person-1". The
            # engine indexes inputs by (name, entity_id) so duplicating is
            # cheap and value-safe (same scalar, different keys).
            for bare, durable in inputs_by_entity.get(root_entity, []):
                input_records.append(
                    {
                        "name": durable,
                        "entity": root_entity_label,
                        "entity_id": member_id,
                        "interval": default_interval,
                        "value": value_for(bare),
                    }
                )
            for rel_name, parent_slot, child_slot in links:
                tuple_vals = ["", ""]
                tuple_vals[parent_slot] = entity_id
                tuple_vals[child_slot] = member_id
                relation_records.append(
                    {
                        "name": rel_name,
                        "tuple": tuple_vals,
                        "interval": default_interval,
                    }
                )
            for rel_name in fallback_relations:
                relation_records.append(
                    {
                        "name": rel_name,
                        "tuple": [member_id, entity_id],
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

    # The engine evaluates each queried output at the query's entity_id.
    # An output scoped to a collection entity (e.g. Person) evaluated at
    # the root entity_id would make the engine look up collection inputs
    # at the wrong scope and error. Split the auto-query into one block
    # per scope: root-scoped outputs queried at `entity_id`; each
    # collection-scoped output queried at each member entity_id (so we
    # get per-member arrays of values back).
    root_query_bare = [
        n for n in query_bare
        if compiled_entities.get(n) in (root_entity, None)
    ]
    # Degenerate-shape fallback: if the auto-query came up empty after
    # scope filtering (no root-scoped leaves in the model, or the caller
    # specified an empty outputs list), pick any root-scoped derived rule
    # so the engine has something to compute and we still produce a
    # response. No program-specific names — just whatever the topology
    # has tagged at root scope.
    if not root_query_bare:
        root_query_bare = sorted(
            n for n, e in compiled_entities.items()
            if e in (root_entity, None) and n in compiled_ids
        )[:1]

    # Per-collection: every derived rule the engine knows about at that
    # scope. We query *all* of them per member so the visualizer can show
    # values on every Person-scoped node, not just leaves.
    member_query_bare: dict[str, list[str]] = {}
    for collection in collection_entities:
        member_query_bare[collection] = sorted(
            n for n, e in compiled_entities.items() if e == collection
        )

    # Track bare ↔ durable for every name we'll see in the response.
    id_to_bare: dict[str, str] = {}
    for n in root_query_bare:
        if n in compiled_ids:
            id_to_bare[compiled_ids[n]] = n
    for names in member_query_bare.values():
        for n in names:
            if n in compiled_ids:
                id_to_bare[compiled_ids[n]] = n

    period_block = {
        "period_kind": "month",
        "start": period_start,
        "end": period_end,
    }

    # First query: root entity, root-scoped outputs.
    queries = [
        {
            "entity_id": entity_id,
            "period": period_block,
            "outputs": [compiled_ids[n] for n in root_query_bare if n in compiled_ids],
        }
    ]
    # Then one query per member, asking for that collection's derived
    # outputs. The engine evaluates each in its own entity context so
    # `{kind: input, name: X}` resolves at the right entity_id, and we
    # get back a separate result block we can merge into arrays.
    for collection, members in member_order_by_collection.items():
        outputs_durable = [
            compiled_ids[n] for n in member_query_bare.get(collection, [])
            if n in compiled_ids
        ]
        if not outputs_durable:
            continue
        for member_id in members:
            queries.append(
                {
                    "entity_id": member_id,
                    "period": period_block,
                    "outputs": outputs_durable,
                }
            )

    request = {
        "mode": "explain",
        "dataset": {
            "inputs": input_records,
            "relations": relation_records,
        },
        "queries": queries,
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

    # Flatten the engine's response into {nodeId: {value}}. Multiple
    # result blocks come back — one per query. The root block keys to
    # `entity_id`; each member block keys to a member id. Root-scoped
    # values become scalar `{value: x}`. Collection-scoped values come
    # back as `{value: [v_member_1, v_member_2, ...]}` in member order,
    # matching factgraph's per-member array convention. Response keys
    # may be bare names (trace) or durable IDs (outputs) — strip the
    # prefix to get the bare node id.
    def to_bare(key: str) -> str:
        if "#" in key:
            return key.rsplit("#", 1)[1]
        return key

    results: dict[str, dict[str, Any]] = {}
    member_results: dict[str, dict[str, Any]] = {}  # bare → {member_id: value}

    for entity_result in response.get("results") or []:
        eid = entity_result.get("entity_id")
        outputs = entity_result.get("outputs") or {}
        trace = entity_result.get("trace") or {}
        is_member = eid in member_id_to_collection
        # Outputs win on trace conflict.
        for key, payload in {**trace, **outputs}.items():
            bare = id_to_bare.get(key) or to_bare(key)
            if bare not in nodes:
                continue
            value = _value_from_payload(payload)
            if is_member:
                member_results.setdefault(bare, {})[eid] = value
            else:
                # Root-scoped result. Don't overwrite an existing member
                # array (shouldn't happen given our scope filtering, but
                # be defensive — collection-scoped wins for clarity).
                if bare not in results:
                    results[bare] = {"value": value}

    # Flatten member result maps into arrays in member-fan-out order.
    all_member_ids: list[str] = []
    for collection in sorted(collection_entities):
        all_member_ids.extend(member_order_by_collection.get(collection, []))
    for bare, by_member in member_results.items():
        # Use only the members actually relevant to this bare node's
        # collection. The bare's compiled entity tells us which group.
        collection = compiled_entities.get(bare)
        member_ids = (
            member_order_by_collection.get(collection, [])
            if collection in collection_entities
            else all_member_ids
        )
        array = [by_member.get(mid) for mid in member_ids]
        results[bare] = {"value": array}

    # Per-member input values aren't in the engine response (the engine
    # only echoes computed values, not inputs). Surface them ourselves so
    # the visualizer can show a result on Person-scoped input nodes too —
    # same array shape as derived values, indexed by member order.
    for collection, member_ids in member_order_by_collection.items():
        slot_bares = [bare for bare, _durable in inputs_by_entity.get(collection, [])]
        for bare in slot_bares:
            if bare not in nodes:
                continue
            array = []
            for mid in member_ids:
                scalar = member_input_scalars.get(mid, {}).get(bare)
                array.append(_scalar_value(scalar) if scalar else None)
            results[bare] = {"value": array}

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
