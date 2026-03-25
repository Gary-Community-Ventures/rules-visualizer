"""Parse .rac files into the rules-visualizer Model JSON format."""

from __future__ import annotations

import hashlib
from datetime import date
from pathlib import Path
from typing import Any

from rac import parse_file, compile
from rac.compiler import IR


def parse_rac_directory(rac_dir: str, ruleset_id: str, as_of: date | None = None) -> dict:
    """Parse all .rac files in a directory into a Model dict.

    Args:
        rac_dir: Path to directory containing .rac files
        ruleset_id: ID for this ruleset
        as_of: Date for temporal resolution (defaults to today)

    Returns:
        Model dict matching the frontend Model type
    """
    if as_of is None:
        as_of = date.today()

    rac_path = Path(rac_dir)
    rac_files = sorted(rac_path.rglob("*.rac"))

    if not rac_files:
        return {
            "id": ruleset_id,
            "name": ruleset_id,
            "format": "rac",
            "nodes": {},
        }

    # Parse all modules
    modules = []
    for f in rac_files:
        try:
            module = parse_file(f)
            modules.append(module)
        except Exception as e:
            print(f"Warning: failed to parse {f}: {e}")

    if not modules:
        return {
            "id": ruleset_id,
            "name": ruleset_id,
            "format": "rac",
            "nodes": {},
        }

    # Compile to get resolved variables with dependencies
    ir = compile(modules, as_of=as_of)

    return ir_to_model(ir, ruleset_id)


def ir_to_model(ir: IR, ruleset_id: str) -> dict:
    """Convert compiled RAC IR to our Model JSON format."""
    nodes: dict[str, dict] = {}
    path_to_id: dict[str, str] = {}

    # First pass: create node IDs
    for i, var_path in enumerate(ir.order):
        node_id = f"rac-{i + 1}"
        path_to_id[var_path] = node_id

    # Second pass: build nodes
    for i, var_path in enumerate(ir.order):
        var = ir.variables[var_path]
        node_id = f"rac-{i + 1}"

        # Resolve dependencies to node IDs
        deps = []
        for dep_path in var.deps:
            dep_id = path_to_id.get(dep_path)
            if dep_id:
                deps.append(dep_id)

        # Determine if this is an entity or variable
        if hasattr(var, "fields") and var.fields:
            content = _make_entity_content(var)
        else:
            content = _make_variable_content(var, var_path)

        node: dict[str, Any] = {
            "id": node_id,
            "name": _path_to_name(var_path),
            "dependencies": deps,
            "content": content,
        }

        if hasattr(var, "description") and var.description:
            node["description"] = var.description

        # Tag with source file if available
        tags = []
        if hasattr(var, "source") and var.source:
            tags.append(var.source)
        if hasattr(var, "entity") and var.entity:
            tags.append(f"entity:{var.entity}")
        if tags:
            node["tags"] = tags

        nodes[node_id] = node

    # Derive a human-readable name from the ruleset ID
    ruleset_name = ruleset_id.replace("-", " ").replace("_", " ").title()

    return {
        "id": ruleset_id,
        "name": ruleset_name,
        "format": "rac",
        "nodes": nodes,
    }


def _make_variable_content(var: Any, var_path: str) -> dict:
    """Create a RacVariable content dict from a ResolvedVar."""
    content: dict[str, Any] = {
        "format": "rac",
        "type": "variable",
        "path": var_path,
    }

    if hasattr(var, "entity") and var.entity:
        content["entity"] = var.entity
    if hasattr(var, "label") and var.label:
        content["label"] = var.label
    if hasattr(var, "unit") and var.unit:
        content["unit"] = var.unit
    if hasattr(var, "default_") and var.default_ is not None:
        content["default"] = str(var.default_)
    if hasattr(var, "source") and var.source:
        content["source"] = var.source

    # Serialize expression to human-readable string
    if hasattr(var, "expr") and var.expr is not None:
        content["expression"] = _serialize_expr(var.expr)

    return content


def _make_entity_content(var: Any) -> dict:
    """Create a RacEntity content dict."""
    fields = []
    for f in var.fields:
        field: dict[str, Any] = {
            "name": f.name,
            "dtype": str(f.dtype) if hasattr(f, "dtype") else "unknown",
        }
        if hasattr(f, "nullable") and f.nullable:
            field["nullable"] = True
        if hasattr(f, "default_") and f.default_ is not None:
            field["default"] = str(f.default_)
        fields.append(field)

    return {
        "format": "rac",
        "type": "entity",
        "fields": fields,
    }


def _serialize_expr(expr: Any) -> str:
    """Serialize a RAC expression AST to a human-readable string."""
    if expr is None:
        return ""

    type_name = type(expr).__name__

    if type_name == "Literal":
        return repr(expr.value)
    elif type_name == "Var":
        return expr.name
    elif type_name == "BinOp":
        left = _serialize_expr(expr.left)
        right = _serialize_expr(expr.right)
        return f"({left} {expr.op} {right})"
    elif type_name == "UnaryOp":
        operand = _serialize_expr(expr.operand)
        return f"{expr.op}({operand})"
    elif type_name == "Call":
        args = ", ".join(_serialize_expr(a) for a in expr.args)
        return f"{expr.func}({args})"
    elif type_name == "Cond":
        parts = []
        for i, (test, body) in enumerate(expr.branches):
            test_s = _serialize_expr(test)
            body_s = _serialize_expr(body)
            keyword = "if" if i == 0 else "elif"
            parts.append(f"{keyword} {test_s}: {body_s}")
        if expr.else_ is not None:
            parts.append(f"else: {_serialize_expr(expr.else_)}")
        return " ".join(parts)
    elif type_name == "Match":
        subject = _serialize_expr(expr.subject)
        arms = ", ".join(
            f"{_serialize_expr(p)} => {_serialize_expr(b)}" for p, b in expr.arms
        )
        return f"match {subject} {{ {arms} }}"
    elif type_name == "Let":
        bindings = ", ".join(
            f"{name} = {_serialize_expr(val)}" for name, val in expr.bindings
        )
        body = _serialize_expr(expr.body)
        return f"let {bindings} in {body}"
    elif type_name == "FieldAccess":
        obj = _serialize_expr(expr.obj)
        return f"{obj}.{expr.field}"
    else:
        return str(expr)


def _path_to_name(path: str) -> str:
    """Extract a short name from a variable path like 'gov/irs/standard_deduction'."""
    parts = path.split("/")
    return parts[-1] if parts else path
