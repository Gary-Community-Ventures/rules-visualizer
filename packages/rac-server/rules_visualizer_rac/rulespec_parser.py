"""Parse RuleSpec YAML compositions into the visualizer Model JSON format.

RuleSpec v1 replaces the old `.rac` format. A composition file declares
imports (jurisdiction-prefixed paths like `us-co:regulations/...`) and
optionally its own rules; each imported module declares more rules. Rules
reference each other by bare name. We walk imports transitively, collect
every rule into a single dictionary, and emit Model nodes.

Identifiers referenced in formulas that don't resolve to a declared rule
are treated as inputs — RuleSpec models inputs implicitly (anything you
need to supply at execution time).

Visualizer-only. The new engine (axiom-rules-engine) is a request/response
client; integrating that is a separate effort.
"""

from __future__ import annotations

import keyword
import re
import tokenize
from io import StringIO
from pathlib import Path
from typing import Any

import yaml


# --- Public entry point ---


def parse_rulespec_composition(
    composition_path: str | Path,
    rulespec_root: str | Path,
    ruleset_id: str,
) -> dict:
    """Load a RuleSpec composition + every transitive import, emit Model JSON.

    Args:
        composition_path: Path to the entry-point YAML (typically a
            `module.kind: composition` file).
        rulespec_root: Directory containing jurisdiction subdirs
            (`us-co/`, `us/`, etc.) used to resolve `<jurisdiction>:path`
            import references.
        ruleset_id: Visualizer-side ruleset identifier.
    """
    root = Path(rulespec_root)
    entry = Path(composition_path)

    loaded: dict[str, dict] = {}  # module_id → parsed YAML
    _load_module_recursive(entry, root, loaded)

    # Catalogue every rule across loaded modules. Bare-name index lets us
    # resolve cross-module formula references.
    rules_by_name: dict[str, dict] = {}
    for module_id, module in loaded.items():
        for rule in module.get("rules", []) or []:
            name = rule.get("name")
            if not name:
                continue
            # First declaration wins. Real conflicts are rare; warn if seen.
            if name in rules_by_name:
                continue
            rules_by_name[name] = {"rule": rule, "module_id": module_id}

    nodes: dict[str, dict] = {}
    input_names: set[str] = set()

    # source_relation rules don't compute a value; they document that this
    # regulation module restates a target rule defined elsewhere. We collect
    # them separately and attach as citations onto the target node after
    # the main pass.
    source_relations: list[tuple[dict, str]] = []  # (rule, owning_module_id)

    # Pass 1: emit a node for every declared rule.
    for name, entry_data in rules_by_name.items():
        rule = entry_data["rule"]
        module_id = entry_data["module_id"]
        kind = rule.get("kind", "derived")

        if kind == "source_relation":
            source_relations.append((rule, module_id))
            continue

        module_data = loaded.get(module_id) or {}
        module_summary = (module_data.get("module") or {}).get("summary")
        node = _rule_to_node(
            name, rule, module_id, rules_by_name, module_summary=module_summary
        )
        nodes[name] = node

        # Track all formula identifiers as potential inputs.
        for tv in _collect_formula_strings(rule):
            input_names |= _extract_identifiers(tv)

    # Pass 2: any identifier referenced but not declared is an input.
    declared = set(nodes.keys())
    for ref in sorted(input_names - declared):
        nodes[ref] = _input_node(ref)

    # Pass 3: wire up dependencies — each rule's deps are the declared
    # identifiers in its formula(s). Inputs have no deps.
    for name, node in nodes.items():
        if node["content"].get("role") == "input":
            continue
        rule = rules_by_name[name]["rule"]
        refs: set[str] = set()
        for formula in _collect_formula_strings(rule):
            refs |= _extract_identifiers(formula)
        # Self-reference filter: a rule's name should never depend on itself.
        refs.discard(name)
        node["dependencies"] = sorted(r for r in refs if r in nodes)

    # Pass 4: attach source_relation citations onto target nodes. The
    # target ID looks like `us:statutes/7/2017/a#snap_regular_month_allotment`;
    # the bare name after `#` matches a node id in our graph.
    for rule, owning_module_id in source_relations:
        rel = rule.get("source_relation") or {}
        target = rel.get("target") or ""
        target_name = target.split("#", 1)[1] if "#" in target else target
        if not target_name or target_name not in nodes:
            continue
        target_node = nodes[target_name]
        citations = target_node["content"].setdefault("citations", [])
        citations.append(
            {
                "source": rule.get("source") or owning_module_id,
                "type": rel.get("type") or "restates",
                "authority": rel.get("authority"),
                "fromModule": owning_module_id,
            }
        )

    # Prefer the entry-module's summary first sentence as the display name
    # if it reads like a title (short enough to fit).
    display_name = _id_to_name(ruleset_id)
    entry_module_id = _path_to_module_id(entry, root)
    entry_module = loaded.get(entry_module_id) or {}
    summary = (entry_module.get("module") or {}).get("summary") or ""
    if summary:
        first_sentence = summary.strip().split(".")[0].strip()
        if 0 < len(first_sentence) <= 80:
            display_name = first_sentence

    return {
        "id": ruleset_id,
        "name": display_name,
        "format": "rac",  # frontend treats RuleSpec as a RAC variant
        "nodes": nodes,
    }


# --- Import resolution ---


def _module_id_to_path(module_id: str, root: Path) -> Path:
    """`us-co:regulations/10-ccr-2506-1/4.401` →
    `<root>/rulespec-us-co/regulations/10-ccr-2506-1/4.401.yaml`.

    The `rulespec-<jurisdiction>` prefix is the canonical layout the upstream
    engine uses (matches the upstream repo names like `rulespec-us-co`)."""
    if ":" not in module_id:
        # Bare local reference — assume already a relative path
        return root / f"{module_id}.yaml"
    jurisdiction, rel = module_id.split(":", 1)
    return root / f"rulespec-{jurisdiction}" / f"{rel}.yaml"


def _load_module_recursive(
    path: Path, root: Path, loaded: dict[str, dict]
) -> None:
    """Load a module and recursively all its imports. Idempotent on cycles."""
    if not path.exists():
        # Missing import — record an empty stub so we don't try again.
        module_id = _path_to_module_id(path, root)
        if module_id in loaded:
            return
        loaded[module_id] = {"rules": [], "_missing": True}
        return

    module_id = _path_to_module_id(path, root)
    if module_id in loaded:
        return
    try:
        with path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
    except Exception as e:
        print(f"  Warning: failed to parse {path}: {e}")
        loaded[module_id] = {"rules": [], "_error": str(e)}
        return

    loaded[module_id] = data

    for imp in data.get("imports", []) or []:
        imp_path = _module_id_to_path(imp, root)
        _load_module_recursive(imp_path, root, loaded)


def _path_to_module_id(path: Path, root: Path) -> str:
    """Reverse of `_module_id_to_path`. Best-effort: produces a
    jurisdiction-prefixed ID when path is under
    `<root>/rulespec-<jurisdiction>/`, else just the bare path string."""
    try:
        rel = path.relative_to(root)
    except ValueError:
        return str(path)
    parts = rel.with_suffix("").parts
    if len(parts) < 2:
        return str(rel.with_suffix(""))
    head = parts[0]
    if head.startswith("rulespec-"):
        return f"{head.removeprefix('rulespec-')}:{'/'.join(parts[1:])}"
    return f"{head}:{'/'.join(parts[1:])}"


# --- Node construction ---


def _rule_to_node(
    name: str,
    rule: dict,
    module_id: str,
    rules_by_name: dict[str, dict],
    module_summary: str | None = None,
) -> dict:
    """Map one RuleSpec rule to a Model node.

    `module_summary` is the per-module `module.summary` text — the closest
    thing RuleSpec has to a description, attached here per-rule so each
    node carries its regulation context."""
    kind = rule.get("kind", "derived")
    dtype = rule.get("dtype")
    entity = rule.get("entity")
    period = rule.get("period")
    unit = rule.get("unit")
    source = rule.get("source")
    indexed_by = rule.get("indexed_by")
    versions = rule.get("versions") or []

    role = _classify_kind(kind, versions)
    latest_formula = _latest_formula(versions)
    latest_values = _latest_values(versions)

    content: dict[str, Any] = {
        "format": "rac",
        "type": "variable",
        "role": role,
        "path": name,
    }
    if entity:
        content["entity"] = entity
    if dtype:
        content["dtype"] = dtype
    if unit:
        content["unit"] = unit
    if period:
        content["period"] = period
    if indexed_by:
        content["indexedBy"] = indexed_by
    if source:
        content["source"] = source
    if module_summary:
        content["moduleSummary"] = module_summary

    if latest_formula is not None and latest_formula != "":
        content["expression"] = latest_formula
        # Keep raw formula for the source-code viewer.
        content["logic"] = latest_formula

    # Parameter tables: `version.values` carries a {key: value} mapping
    # instead of a formula. Preserve as structured data so the frontend can
    # render it instead of showing an empty `expression`.
    if latest_values is not None:
        content["valueTable"] = latest_values

    # Multiple versions → expose as temporal values (consistent with old .rac).
    if len(versions) > 1:
        content["temporalValues"] = [
            {
                "from": str(v.get("effective_from", "")),
                **(
                    {"to": str(v["effective_to"])}
                    if v.get("effective_to")
                    else {}
                ),
                "expression": (
                    str(v.get("formula", ""))
                    if v.get("formula") is not None
                    else ""
                ),
            }
            for v in versions
        ]

    node: dict[str, Any] = {
        "id": name,
        "name": name,
        "dependencies": [],  # filled in pass 3
        "content": content,
        "overridable": True,
    }
    if rule.get("description"):
        node["description"] = rule["description"]

    tags = [f"kind:{kind}", f"module:{module_id}"]
    if entity:
        tags.append(f"entity:{entity}")
    node["tags"] = tags

    return node


def _latest_values(versions: list[dict]) -> dict | None:
    """Like `_latest_formula` but for `version.values` (parameter tables)."""
    if not versions:
        return None
    candidates = [v for v in versions if v.get("values") is not None]
    if not candidates:
        return None
    with_dates = [v for v in candidates if v.get("effective_from")]
    if with_dates:
        with_dates.sort(key=lambda v: str(v["effective_from"]))
        latest = with_dates[-1]
    else:
        latest = candidates[-1]
    values = latest.get("values")
    if not isinstance(values, dict):
        return None
    # Normalize keys to strings so the JSON round-trip is stable (YAML may
    # parse integer keys for size-indexed tables; the frontend treats them
    # as strings).
    return {str(k): v for k, v in values.items()}


def _input_node(name: str) -> dict:
    """Synthesize an input node for an identifier referenced but not declared
    as a rule in any loaded module."""
    return {
        "id": name,
        "name": name,
        "dependencies": [],
        "content": {
            "format": "rac",
            "type": "variable",
            "role": "input",
            "path": name,
        },
        "overridable": True,
        "tags": ["input", "kind:input"],
    }


def _classify_kind(kind: str, versions: list[dict]) -> str:
    """Map RuleSpec rule.kind to our role classifier (input/constant/computed)."""
    if kind == "parameter":
        return "constant"
    # `data_relation` declares an external relation feed (e.g.
    # `member_of_household`). Treated as input from the graph's perspective.
    if kind == "data_relation":
        return "input"
    # `derived` with a formula that's just a literal is also a "constant"
    # in our taxonomy, but cheap to over-classify as "computed".
    if kind == "derived":
        formula = _latest_formula(versions) or ""
        # Simple literal check: pure number / pure string.
        stripped = formula.strip()
        if re.fullmatch(r"-?\d+(?:\.\d+)?", stripped):
            return "constant"
        if re.fullmatch(r"'[^']*'", stripped) or re.fullmatch(
            r'"[^"]*"', stripped
        ):
            return "constant"
        return "computed"
    return "computed"


def _latest_formula(versions: list[dict]) -> str | None:
    if not versions:
        return None
    # Versions usually arrive in chronological order. The "latest" is the
    # one with the most recent effective_from; fall back to last item.
    sortable = [v for v in versions if v.get("effective_from")]
    if sortable:
        sortable.sort(key=lambda v: str(v["effective_from"]))
        return str(sortable[-1].get("formula", ""))
    return str(versions[-1].get("formula", "")) if versions else None


def _collect_formula_strings(rule: dict) -> list[str]:
    """Every formula across every version of a rule."""
    out: list[str] = []
    for v in rule.get("versions") or []:
        f = v.get("formula")
        if isinstance(f, str):
            out.append(f)
    return out


# --- Formula identifier extraction ---


# Keywords + builtins we don't want to register as inputs. Builtins were
# inferred by grepping all `name(` patterns across rulespec-us and
# rulespec-us-co; expand as new ones appear.
_FORMULA_KEYWORDS = set(keyword.kwlist) | {
    "and",
    "or",
    "not",
    "if",
    "else",
    "elif",
    "True",
    "False",
    "None",
    "in",
    "for",
    # Python builtins commonly used in formulas
    "min",
    "max",
    "sum",
    "len",
    "abs",
    "round",
    # RuleSpec aggregation/relational builtins
    "count_where",
    "sum_where",
    "any_where",
    "all_where",
    "filter_where",
    # Math + date helpers
    "floor",
    "ceil",
    "days_between",
    "date_add_days",
}


_IDENT_RE = re.compile(r"\b[A-Za-z_][A-Za-z0-9_]*\b")
# Skip identifiers preceded by `.` (attribute access — not a binding).
_DOTTED_TAIL_RE = re.compile(r"\.\s*\b([A-Za-z_][A-Za-z0-9_]*)\b")


def _extract_identifiers_regex(formula: str) -> set[str]:
    """Lightweight fallback identifier extractor. Strips attribute-access
    tails (`foo.bar` → keep `foo`, drop `bar`) so dotted refs don't pollute
    the input-name set."""
    refs: set[str] = set()
    # Find every identifier, then remove the ones that appear right after a dot.
    attribute_tails = {m.group(1) for m in _DOTTED_TAIL_RE.finditer(formula)}
    for m in _IDENT_RE.finditer(formula):
        ident = m.group(0)
        if ident in _FORMULA_KEYWORDS:
            continue
        # Was this match preceded by a dot? If so, skip — it's an attribute.
        start = m.start()
        if start > 0:
            # Walk back over whitespace.
            j = start - 1
            while j >= 0 and formula[j] in " \t":
                j -= 1
            if j >= 0 and formula[j] == ".":
                continue
        refs.add(ident)
    _ = attribute_tails  # reserved for future use; right-side already filtered
    return refs


def _extract_identifiers(formula: str) -> set[str]:
    """Pull bare identifiers out of a formula. Misses dotted references on
    purpose — those refer to fields on a value, not separately-bound names."""
    refs: set[str] = set()
    if not formula:
        return refs
    try:
        toks = list(tokenize.generate_tokens(StringIO(formula).readline))
    except (tokenize.TokenError, IndentationError, SyntaxError):
        # Fall back to regex — many RuleSpec formulas use indentation patterns
        # the Python tokenizer rejects (the `formula:` body isn't a full
        # Python file).
        return _extract_identifiers_regex(formula)

    prev: tokenize.TokenInfo | None = None
    for tok in toks:
        if tok.type != tokenize.NAME:
            prev = tok
            continue
        ident = tok.string
        if ident in _FORMULA_KEYWORDS:
            prev = tok
            continue
        # Skip the right-hand side of attribute access (`x.field` — `field`
        # is not a binding).
        if prev is not None and prev.type == tokenize.OP and prev.string == ".":
            prev = tok
            continue
        refs.add(ident)
        prev = tok
    return refs


# --- Misc ---


def _id_to_name(ruleset_id: str) -> str:
    return ruleset_id.replace("-", " ").replace("_", " ").title()
