"""Attach references.json policy-doc citations onto Model nodes.

Separate from the parser because it's a generic post-processing step that
works on any Model regardless of source format (old `.rac` or new RuleSpec).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def resolve_references(model: dict[str, Any], ruleset_dir: str) -> None:
    """Load `<ruleset_dir>/references.json` and attach resolved
    {section, document} entries onto each mapped node's `references` field.
    Silently no-ops if the file is missing or malformed."""
    ref_path = Path(ruleset_dir) / "references.json"
    if not ref_path.is_file():
        return

    try:
        refs = json.loads(ref_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"  Warning: failed to parse references.json: {e}")
        return

    docs_by_id = {d["id"]: d for d in refs.get("documents", [])}
    sections_by_id = {s["id"]: s for s in refs.get("sections", [])}

    mappings_by_path: dict[str, list[str]] = {}
    for m in refs.get("mappings", []):
        mappings_by_path.setdefault(m["nodePath"], []).append(m["sectionId"])

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
