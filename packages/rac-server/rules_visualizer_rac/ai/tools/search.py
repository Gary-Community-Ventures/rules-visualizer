"""Search tools for the RAC AI assistant."""

from __future__ import annotations

from langchain_core.tools import tool

from rules_visualizer_rac.server import get_rulesets


def _get_model(ruleset_id: str) -> dict:
    rulesets = get_rulesets()
    model = rulesets.get(ruleset_id)
    if not model:
        raise ValueError(f'Ruleset "{ruleset_id}" not found')
    return model


def _get_nodes(model: dict) -> dict[str, dict]:
    return model.get("nodes", {})


def _name_map(model: dict) -> dict[str, dict]:
    return {node["name"].lower(): node for node in _get_nodes(model).values()}


@tool
def list_nodes(ruleset_id: str) -> str:
    """List all nodes in the ruleset with their type and a brief description."""
    model = _get_model(ruleset_id)
    nodes = _get_nodes(model)
    lines = []
    for node in nodes.values():
        c = node["content"]
        node_type = c.get("type", "unknown")
        desc = node.get("description", "")
        desc_preview = f": {desc[:80]}" if desc else ""
        lines.append(f"- {node['name']} [{node_type}]{desc_preview}")
    return f"Found {len(lines)} nodes:\n" + "\n".join(lines)


@tool
def get_nodes(ruleset_id: str, names: list[str]) -> str:
    """Get full details for one or more nodes by name, including their logic, dependencies, and metadata."""
    model = _get_model(ruleset_id)
    nodes = _get_nodes(model)
    nm = _name_map(model)

    results = []
    for name in names:
        node = nm.get(name.lower())
        if not node:
            results.append(f'Node "{name}" not found.')
            continue

        c = node["content"]
        dep_names = [
            nodes[dep_id]["name"]
            for dep_id in node.get("dependencies", [])
            if dep_id in nodes
        ]

        parts = [
            f"Name: {node['name']}",
        ]
        if node.get("description"):
            parts.append(f"Description: {node['description']}")
        parts.append(f"Type: {c.get('type', 'unknown')}")
        if c.get("label"):
            parts.append(f"Label: {c['label']}")
        if c.get("entity"):
            parts.append(f"Entity: {c['entity']}")
        if c.get("unit"):
            parts.append(f"Unit: {c['unit']}")
        if dep_names:
            parts.append(f"Dependencies: {', '.join(dep_names)}")
        else:
            parts.append("Dependencies: none (leaf node)")
        if c.get("logic"):
            parts.append(f"Logic:\n{c['logic']}")
        if c.get("default"):
            parts.append(f"Default: {c['default']}")

        results.append("\n".join(parts))

    return "\n\n---\n\n".join(results)


@tool
def search_nodes(ruleset_id: str, query: str) -> str:
    """Search for nodes by name or description text."""
    model = _get_model(ruleset_id)
    q = query.lower()
    matches = [
        node
        for node in _get_nodes(model).values()
        if q in node["name"].lower()
        or q in (node.get("description") or "").lower()
    ]
    if not matches:
        return "No nodes matched."
    return "\n".join(
        f"- {node['name']}: {(node.get('description') or '(no description)')[:100]}"
        for node in matches[:20]
    )


@tool
def get_dependencies(ruleset_id: str, name: str) -> str:
    """Get the dependency chain for a node — what other nodes it depends on."""
    model = _get_model(ruleset_id)
    nodes = _get_nodes(model)
    nm = _name_map(model)
    node = nm.get(name.lower())
    if not node:
        return f'Node "{name}" not found.'
    deps = [
        nodes[dep_id]
        for dep_id in node.get("dependencies", [])
        if dep_id in nodes
    ]
    if not deps:
        return f"{node['name']} has no dependencies (it's a leaf/input node)."
    lines = [
        f"- {d['name']}: {(d.get('description') or '')[:80]}" for d in deps
    ]
    return f"Dependencies of {node['name']}:\n" + "\n".join(lines)


SEARCH_TOOLS = [list_nodes, get_nodes, search_nodes, get_dependencies]
