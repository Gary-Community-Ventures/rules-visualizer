"""Parse .rac files into the rules-visualizer Model JSON format."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any


def parse_rac_directory(
    rac_dir: str, ruleset_id: str, as_of: date | None = None
) -> dict:
    """Parse all .rac files in a directory into a Model dict.

    Args:
        rac_dir: Path to directory containing .rac files
        ruleset_id: ID for this ruleset
        as_of: Date for temporal resolution (defaults to today)

    Returns:
        Model dict matching the frontend Model type
    """
    from rac import parse_file, compile

    if as_of is None:
        as_of = date.today()

    rac_path = Path(rac_dir)
    rac_files = sorted(rac_path.rglob("*.rac"))

    if not rac_files:
        return _empty_model(ruleset_id)

    # Parse all modules
    modules = []
    for f in rac_files:
        try:
            module = parse_file(f)
            modules.append(module)
        except Exception as e:
            print(f"  Warning: failed to parse {f.name}: {e}")

    if not modules:
        return _empty_model(ruleset_id)

    # Compile to get resolved variables with temporal resolution
    try:
        ir = compile(modules, as_of=as_of)
    except Exception as e:
        print(f"  Warning: compile failed for {ruleset_id}: {e}")
        # Fall back to uncompiled variable declarations
        return _modules_to_model(modules, ruleset_id)

    return _ir_to_model(ir, ruleset_id)


def _empty_model(ruleset_id: str) -> dict:
    return {
        "id": ruleset_id,
        "name": _id_to_name(ruleset_id),
        "format": "rac",
        "nodes": {},
    }


def _ir_to_model(ir: Any, ruleset_id: str) -> dict:
    """Convert compiled RAC IR to our Model JSON format."""
    nodes: dict[str, dict] = {}
    path_to_id: dict[str, str] = {}

    # Build path→id map
    for i, var_path in enumerate(ir.order):
        path_to_id[var_path] = f"rac-{i + 1}"

    # Build nodes
    for i, var_path in enumerate(ir.order):
        var = ir.variables[var_path]
        vd = var.model_dump()
        node_id = path_to_id[var_path]

        # Extract dependencies from expression tree
        expr_refs = _collect_var_refs(vd.get("expr"))
        deps = [path_to_id[ref] for ref in expr_refs if ref in path_to_id]

        # Build content
        content: dict[str, Any] = {
            "format": "rac",
            "type": "variable",
            "path": var_path,
        }

        if vd.get("entity"):
            content["entity"] = vd["entity"]
        if vd.get("label"):
            content["label"] = vd["label"]
        if vd.get("unit"):
            content["unit"] = vd["unit"]
        if vd.get("default") is not None:
            content["default"] = str(vd["default"])
        if vd.get("source"):
            content["source"] = vd["source"]

        # Serialize expression
        if vd.get("expr") is not None:
            content["expression"] = _serialize_expr(vd["expr"])

        # Build node
        node: dict[str, Any] = {
            "id": node_id,
            "name": _path_to_name(var_path),
            "dependencies": deps,
            "content": content,
        }

        if vd.get("description"):
            node["description"] = vd["description"]

        tags: list[str] = []
        if vd.get("entity"):
            tags.append(f"entity:{vd['entity']}")
        if tags:
            node["tags"] = tags

        nodes[node_id] = node

    return {
        "id": ruleset_id,
        "name": _id_to_name(ruleset_id),
        "format": "rac",
        "nodes": nodes,
    }


def _modules_to_model(modules: list[Any], ruleset_id: str) -> dict:
    """Fallback: build model directly from parsed modules (no compile step).

    Used when compile fails (e.g. duplicate variables across files).
    """
    nodes: dict[str, dict] = {}
    path_to_id: dict[str, str] = {}
    seen_paths: set[str] = set()
    all_vars: list[tuple[str, dict, str]] = []  # (path, var_dump, filename)

    for mod in modules:
        filename = Path(str(mod.path)).stem if mod.path else "unknown"
        for v in mod.variables:
            vd = v.model_dump()
            var_path = vd["path"]
            if var_path in seen_paths:
                continue  # skip duplicates
            seen_paths.add(var_path)
            all_vars.append((var_path, vd, filename))

    # Build path→id map
    for i, (var_path, _, _) in enumerate(all_vars):
        path_to_id[var_path] = f"rac-{i + 1}"

    # Build nodes
    for i, (var_path, vd, filename) in enumerate(all_vars):
        node_id = path_to_id[var_path]

        # Extract deps from all temporal values' expressions
        all_refs: set[str] = set()
        for tv in vd.get("values", []):
            all_refs |= _collect_var_refs(tv.get("expr"))
        deps = [path_to_id[ref] for ref in all_refs if ref in path_to_id]

        content: dict[str, Any] = {
            "format": "rac",
            "type": "variable",
            "path": var_path,
        }

        if vd.get("entity"):
            content["entity"] = vd["entity"]
        if vd.get("label"):
            content["label"] = vd["label"]
        if vd.get("unit"):
            content["unit"] = vd["unit"]
        if vd.get("default") is not None:
            content["default"] = str(vd["default"])
        if vd.get("source"):
            content["source"] = vd["source"]

        # Use the most recent temporal value's expression
        values = vd.get("values", [])
        if values:
            latest = values[-1]
            if latest.get("expr") is not None:
                content["expression"] = _serialize_expr(latest["expr"])

            # Include temporal values if there are multiple
            if len(values) > 1:
                content["temporalValues"] = [
                    {
                        "from": str(tv["start"]),
                        **({"to": str(tv["end"])} if tv.get("end") else {}),
                        "expression": _serialize_expr(tv.get("expr")),
                    }
                    for tv in values
                ]

        node: dict[str, Any] = {
            "id": node_id,
            "name": _path_to_name(var_path),
            "dependencies": deps,
            "content": content,
        }

        if vd.get("description"):
            node["description"] = vd["description"]

        tags: list[str] = [filename]
        if vd.get("entity"):
            tags.append(f"entity:{vd['entity']}")
        node["tags"] = tags

        nodes[node_id] = node

    # Also add entities
    entity_offset = len(all_vars)
    seen_entities: set[str] = set()
    for mod in modules:
        for ent in mod.entities:
            ed = ent.model_dump()
            ent_name = ed.get("name", "unknown")
            if ent_name in seen_entities:
                continue
            seen_entities.add(ent_name)

            node_id = f"rac-{entity_offset + len(seen_entities)}"
            fields = []
            for f in ed.get("fields", []):
                field: dict[str, Any] = {
                    "name": f.get("name", "?"),
                    "dtype": str(f.get("dtype", "unknown")),
                }
                if f.get("nullable"):
                    field["nullable"] = True
                if f.get("default") is not None:
                    field["default"] = str(f["default"])
                fields.append(field)

            nodes[node_id] = {
                "id": node_id,
                "name": ent_name,
                "dependencies": [],
                "content": {
                    "format": "rac",
                    "type": "entity",
                    "fields": fields,
                },
            }

    return {
        "id": ruleset_id,
        "name": _id_to_name(ruleset_id),
        "format": "rac",
        "nodes": nodes,
    }


# --- Expression utilities ---


def _collect_var_refs(expr: Any) -> set[str]:
    """Recursively collect all variable references from an expression dict."""
    if expr is None:
        return set()
    refs: set[str] = set()
    if isinstance(expr, dict):
        if expr.get("type") == "var":
            refs.add(expr["path"])
        for v in expr.values():
            refs |= _collect_var_refs(v)
    elif isinstance(expr, list):
        for item in expr:
            refs |= _collect_var_refs(item)
    return refs


def _serialize_expr(expr: Any) -> str:
    """Serialize a RAC expression dict to a human-readable string."""
    if expr is None:
        return ""
    if not isinstance(expr, dict):
        return str(expr)

    t = expr.get("type")

    if t == "literal":
        return repr(expr["value"])

    if t == "var":
        return expr["path"]

    if t == "binop":
        left = _serialize_expr(expr.get("left"))
        right = _serialize_expr(expr.get("right"))
        op = expr.get("op", "?")
        return f"({left} {op} {right})"

    if t == "unaryop":
        operand = _serialize_expr(expr.get("operand"))
        op = expr.get("op", "?")
        return f"{op}({operand})"

    if t == "call":
        args = ", ".join(_serialize_expr(a) for a in expr.get("args", []))
        return f"{expr.get('func', '?')}({args})"

    if t == "cond":
        cond = _serialize_expr(expr.get("condition"))
        then = _serialize_expr(expr.get("then_expr"))
        else_ = expr.get("else_expr")
        if else_ is not None:
            # Check if else is another cond (elif chain)
            if isinstance(else_, dict) and else_.get("type") == "cond":
                return f"if {cond}: {then} el{_serialize_expr(else_)}"
            return f"if {cond}: {then} else: {_serialize_expr(else_)}"
        return f"if {cond}: {then}"

    if t == "match":
        subject = _serialize_expr(expr.get("subject"))
        arms = ", ".join(
            f"{_serialize_expr(p)} => {_serialize_expr(b)}"
            for p, b in expr.get("arms", [])
        )
        return f"match {subject} {{ {arms} }}"

    if t == "let":
        bindings = ", ".join(
            f"{name} = {_serialize_expr(val)}"
            for name, val in expr.get("bindings", [])
        )
        body = _serialize_expr(expr.get("body"))
        return f"let {bindings} in {body}"

    if t == "field_access":
        obj = _serialize_expr(expr.get("obj"))
        return f"{obj}.{expr.get('field', '?')}"

    if t == "list":
        items = ", ".join(_serialize_expr(item) for item in expr.get("items", []))
        return f"[{items}]"

    if t == "index":
        obj = _serialize_expr(expr.get("obj"))
        idx = _serialize_expr(expr.get("index"))
        return f"{obj}[{idx}]"

    # Unknown expression type — show it generically
    return str(expr)


# --- Name utilities ---


def _path_to_name(path: str) -> str:
    """Extract a short display name from a variable path."""
    parts = path.split("/")
    name = parts[-1] if parts else path
    return name.replace("_", " ").title()


def _id_to_name(ruleset_id: str) -> str:
    """Convert a ruleset ID to a display name."""
    return ruleset_id.replace("-", " ").replace("_", " ").title()
