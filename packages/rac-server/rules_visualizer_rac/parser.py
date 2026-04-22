"""Parse .rac files into the rules-visualizer Model JSON format."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any


def parse_rac_directory(
    rac_dir: str, ruleset_id: str, as_of: date | None = None
) -> tuple[dict, Any | None]:
    """Parse all .rac files in a directory into a Model dict.

    Args:
        rac_dir: Path to directory containing .rac files
        ruleset_id: ID for this ruleset
        as_of: Date for temporal resolution (defaults to today)

    Returns:
        Tuple of (Model dict, compiled IR or None if compile failed)
    """
    from rac import parse_file, compile

    if as_of is None:
        as_of = date.today()

    rac_path = Path(rac_dir)
    rac_files = sorted(rac_path.rglob("*.rac"))

    if not rac_files:
        return _empty_model(ruleset_id), None

    # Extract raw source blocks from all .rac files
    logic_blocks = _extract_logic_blocks(rac_files)

    # Parse all modules
    modules = []
    for f in rac_files:
        try:
            module = parse_file(f)
            modules.append(module)
        except Exception as e:
            print(f"  Warning: failed to parse {f.name}: {e}")

    if not modules:
        return _empty_model(ruleset_id), None

    # Compile to get resolved variables with temporal resolution
    try:
        ir = compile(modules, as_of=as_of)
    except Exception as e:
        print(f"  Warning: compile failed for {ruleset_id}: {e}")
        # Fall back to uncompiled variable declarations
        return _modules_to_model(modules, ruleset_id, logic_blocks), None

    return _ir_to_model(ir, modules, ruleset_id, logic_blocks), ir


def _extract_logic_blocks(rac_files: list[Path]) -> dict[str, str]:
    """Read .rac files and extract the ``from`` blocks for each variable.

    Returns a dict mapping variable name to the concatenated ``from ...``
    temporal expression blocks (the calculation/logic portion only).
    """
    blocks: dict[str, str] = {}
    for filepath in rac_files:
        try:
            text = filepath.read_text(encoding="utf-8")
        except Exception:
            continue

        lines = text.split("\n")
        current_var: str | None = None
        from_lines: list[str] = []
        in_from = False

        for line in lines:
            stripped = line.rstrip()
            # A top-level key: non-empty, not indented, not a comment, not a
            # docstring delimiter, and ends with ':'
            if (
                stripped
                and not stripped.startswith((" ", "\t", "#", '"'))
                and stripped.endswith(":")
                and not stripped.startswith("status")
            ):
                # Save previous variable's from blocks
                if current_var is not None and from_lines:
                    blocks[current_var] = "\n".join(from_lines).rstrip()
                current_var = stripped[:-1].strip()
                from_lines = []
                in_from = False
            elif current_var is not None:
                lstripped = stripped.lstrip()
                if lstripped.startswith("from ") and lstripped.endswith(":"):
                    in_from = True
                    from_lines.append(stripped)
                elif in_from:
                    # Indented content under a from block, or blank line
                    if stripped == "" or stripped.startswith((" ", "\t")):
                        from_lines.append(stripped)
                    else:
                        in_from = False

        # Save last variable
        if current_var is not None and from_lines:
            blocks[current_var] = "\n".join(from_lines).rstrip()

    return blocks


def _empty_model(ruleset_id: str) -> dict:
    return {
        "id": ruleset_id,
        "name": _id_to_name(ruleset_id),
        "format": "rac",
        "nodes": {},
    }


def _classify_ir_variable(vd: dict) -> str:
    """Classify a compiled IR variable as input, constant, or computed."""
    expr = vd.get("expr")
    if expr is None:
        return "input"
    if expr.get("type") == "literal":
        return "constant"
    return "computed"


def _ir_to_model(
    ir: Any,
    modules: list[Any],
    ruleset_id: str,
    logic_blocks: dict[str, str] | None = None,
) -> dict:
    """Convert compiled RAC IR to our Model JSON format.

    Also includes input variables from the raw modules that the compiler drops.
    """
    nodes: dict[str, dict] = {}
    path_to_id: dict[str, str] = {}

    # Collect input variables from modules that the compiler drops.
    # These are variables with no temporal values (no "from YYYY:" expression).
    input_vars: list[tuple[str, dict]] = []
    seen_paths: set[str] = set(ir.order)

    for mod in modules:
        for v in mod.variables:
            vd = v.model_dump()
            var_path = vd["path"]
            if var_path in seen_paths:
                continue
            values = vd.get("values", [])
            has_expr = any(tv.get("expr") is not None for tv in values)
            if not has_expr:
                seen_paths.add(var_path)
                input_vars.append((var_path, vd))

    # Build path→id map for all variables. IDs are just the variable path —
    # paths are unique and this keeps workspace/selection state stable across
    # edits (reordering variables no longer shifts IDs).
    all_paths = list(ir.order) + [p for p, _ in input_vars]
    for var_path in all_paths:
        path_to_id[var_path] = var_path

    # Build nodes from compiled IR
    for i, var_path in enumerate(ir.order):
        var = ir.variables[var_path]
        vd = var.model_dump()
        node_id = path_to_id[var_path]
        role = _classify_ir_variable(vd)

        # Extract dependencies from expression tree
        expr_refs = _collect_var_refs(vd.get("expr"))
        deps = [path_to_id[ref] for ref in expr_refs if ref in path_to_id]

        # Build content
        content: dict[str, Any] = {
            "format": "rac",
            "type": "variable",
            "role": role,
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

        # Attach raw source code from the .rac file
        if logic_blocks:
            # The variable name is the last segment of the path
            var_name = var_path.rsplit("/", 1)[-1] if "/" in var_path else var_path
            if var_name in logic_blocks:
                content["logic"] = logic_blocks[var_name]

        # Build node — all RAC variables are overridable
        node: dict[str, Any] = {
            "id": node_id,
            "name": _path_to_name(var_path),
            "dependencies": deps,
            "content": content,
            "overridable": True,
        }

        if vd.get("description"):
            node["description"] = vd["description"]

        nodes[node_id] = node

    # Build nodes from input variables (dropped by compiler)
    for var_path, vd in input_vars:
        node_id = path_to_id[var_path]

        content: dict[str, Any] = {
            "format": "rac",
            "type": "variable",
            "role": "input",
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

        node: dict[str, Any] = {
            "id": node_id,
            "name": _path_to_name(var_path),
            "dependencies": [],
            "content": content,
            "overridable": True,
        }

        if vd.get("description"):
            node["description"] = vd["description"]

        tags: list[str] = []
        if vd.get("entity"):
            tags.append(f"entity:{vd['entity']}")
        tags.append("input")
        node["tags"] = tags

        nodes[node_id] = node

    # Wire up dependencies from computed nodes to input nodes.
    # Computed nodes may reference input variables by path.
    for node in nodes.values():
        if node["content"].get("role") != "computed":
            continue
        # Check if any expr refs point to input variables
        expr = node["content"].get("expression", "")
        for var_path, vd in input_vars:
            inp_id = path_to_id[var_path]
            # Check if this input is referenced in the node's expression refs
            # We already built deps from _collect_var_refs, just need to check
            # if the input path was in the refs
            if inp_id not in node["dependencies"]:
                # Re-check from the IR variable's expression
                ir_var_path = None
                for p in ir.order:
                    if path_to_id[p] == node["id"]:
                        ir_var_path = p
                        break
                if ir_var_path:
                    var = ir.variables[ir_var_path]
                    refs = _collect_var_refs(var.model_dump().get("expr"))
                    if var_path in refs:
                        node["dependencies"].append(inp_id)

    return {
        "id": ruleset_id,
        "name": _id_to_name(ruleset_id),
        "format": "rac",
        "nodes": nodes,
    }


def _modules_to_model(modules: list[Any], ruleset_id: str, logic_blocks: dict[str, str] | None = None) -> dict:
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

    # Build path→id map — IDs are just the variable path (stable across edits)
    for var_path, _, _ in all_vars:
        path_to_id[var_path] = var_path

    # Build nodes
    for i, (var_path, vd, filename) in enumerate(all_vars):
        node_id = path_to_id[var_path]

        # Classify role
        values = vd.get("values", [])
        has_expr = any(tv.get("expr") is not None for tv in values)
        is_literal = (
            len(values) == 1
            and values[0].get("expr", {}).get("type") == "literal"
            if values
            else False
        )

        if not has_expr:
            role = "input"
        elif is_literal:
            role = "constant"
        else:
            role = "computed"

        # Extract deps from all temporal values' expressions
        all_refs: set[str] = set()
        for tv in values:
            all_refs |= _collect_var_refs(tv.get("expr"))
        deps = [path_to_id[ref] for ref in all_refs if ref in path_to_id]

        content: dict[str, Any] = {
            "format": "rac",
            "type": "variable",
            "role": role,
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

        # Attach raw source code from the .rac file
        if logic_blocks:
            var_name = var_path.rsplit("/", 1)[-1] if "/" in var_path else var_path
            if var_name in logic_blocks:
                content["logic"] = logic_blocks[var_name]

        node: dict[str, Any] = {
            "id": node_id,
            "name": _path_to_name(var_path),
            "dependencies": deps,
            "content": content,
            "overridable": True,
        }

        if vd.get("description"):
            node["description"] = vd["description"]

        nodes[node_id] = node

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
        name = expr.get("name", "?")
        value = _serialize_expr(expr.get("value"))
        body = _serialize_expr(expr.get("body"))
        return f"{name} = {value}\n{body}"

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
    return parts[-1] if parts else path


# --- Policy references ---


def resolve_references(model: dict[str, Any], ruleset_dir: str) -> None:
    """Load references.json and attach resolved references to model nodes."""
    ref_path = Path(ruleset_dir) / "references.json"
    if not ref_path.is_file():
        return

    import json

    try:
        refs = json.loads(ref_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"  Warning: failed to parse references.json: {e}")
        return

    docs_by_id = {d["id"]: d for d in refs.get("documents", [])}
    sections_by_id = {s["id"]: s for s in refs.get("sections", [])}

    # Group mappings by node path
    mappings_by_path: dict[str, list[str]] = {}
    for m in refs.get("mappings", []):
        mappings_by_path.setdefault(m["nodePath"], []).append(m["sectionId"])

    # Resolve onto nodes (RAC nodes use variable name as node.name)
    for node in model.get("nodes", {}).values():
        node_name = node.get("name", "")
        section_ids = mappings_by_path.get(node_name)
        if not section_ids:
            continue

        resolved = []
        for section_id in section_ids:
            section = sections_by_id.get(section_id)
            if not section:
                continue
            doc = docs_by_id.get(section.get("documentId", ""))
            if not doc:
                continue
            resolved.append({"section": section, "document": doc})

        if resolved:
            node["references"] = resolved


def _id_to_name(ruleset_id: str) -> str:
    """Convert a ruleset ID to a display name."""
    return ruleset_id.replace("-", " ").replace("_", " ").title()
