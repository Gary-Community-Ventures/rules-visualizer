"""CLI entry point for the RAC rules visualizer server.

Loads RuleSpec compositions (`format: rulespec/v1` YAML) from a content
root and serves them via the HTTP API. The old `.rac` parser path was
removed in favor of the new format; execution against axiom-rules-engine
is a pending follow-up.
"""

from __future__ import annotations

import argparse
import os
import webbrowser
from pathlib import Path

from .references import resolve_references
from .rulespec_parser import parse_rulespec_composition
from .server import (
    set_rulesets,
    set_ruleset_dir,
    set_ruleset_composition,
    run_server,
)


def _load_env() -> None:
    """Load .env from current directory or any parent."""
    d = Path.cwd()
    while True:
        env_file = d / ".env"
        if env_file.is_file():
            for line in env_file.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                eq = line.find("=")
                if eq == -1:
                    continue
                key, value = line[:eq], line[eq + 1:]
                if key not in os.environ:
                    os.environ[key] = value
            return
        parent = d.parent
        if parent == d:
            return
        d = parent


def _find_rulespec_root(data_dir: Path) -> Path | None:
    """Locate the RuleSpec content root.

    The "root" is the directory that contains `rulespec-<jurisdiction>/`
    subdirectories (e.g. `rulespec-us-co/`, `rulespec-us/`). This is the
    same shape the upstream axiom-rules-engine expects when resolving
    `us-co:foo/bar` imports — so we use it natively and avoid symlinks.

    Accepts either:
    - the data_dir itself (it contains `rulespec-X/` subdirs)
    - `<data_dir>/../rulespec` or `<data_dir>/rulespec` (sibling/nested layout)
    """
    def has_jurisdiction_dirs(p: Path) -> bool:
        if not p.is_dir():
            return False
        return any(c.is_dir() and c.name.startswith("rulespec-") for c in p.iterdir())

    if has_jurisdiction_dirs(data_dir):
        return data_dir
    for c in (data_dir.parent / "rulespec", data_dir / "rulespec"):
        if has_jurisdiction_dirs(c):
            return c
    return None


def _find_rulespec_compositions(rulespec_root: Path) -> list[tuple[Path, str]]:
    """Find every YAML under `<rulespec_root>/rulespec-<juris>/policies/**`
    whose top-level `module.kind` is `composition`. Returns
    (path, ruleset_id) pairs."""
    import yaml

    out: list[tuple[Path, str]] = []
    for juris_dir in sorted(rulespec_root.iterdir()):
        if not juris_dir.is_dir() or not juris_dir.name.startswith("rulespec-"):
            continue
        policies = juris_dir / "policies"
        if not policies.is_dir():
            continue
        # Strip the `rulespec-` prefix from the dir name for the ruleset id.
        juris_short = juris_dir.name.removeprefix("rulespec-")
        for yaml_path in sorted(policies.rglob("*.yaml")):
            # Skip test fixtures
            if yaml_path.name.endswith(".test.yaml"):
                continue
            try:
                with yaml_path.open("r", encoding="utf-8") as f:
                    data = yaml.safe_load(f) or {}
            except Exception:
                continue
            module = data.get("module") or {}
            if module.get("kind") != "composition":
                continue
            # Ruleset ID: juris + parent-of-file + filename.
            # `rulespec-us-co/policies/cdhs/snap/fy-2026-benefit-calculation.yaml`
            # → `us-co-snap-fy-2026-benefit-calculation`.
            parent = yaml_path.parent.name
            stem = yaml_path.stem
            ruleset_id = f"{juris_short}-{parent}-{stem}".replace("_", "-")
            out.append((yaml_path, ruleset_id))
    return out


def main() -> None:
    _load_env()
    parser = argparse.ArgumentParser(
        description="Serve RuleSpec rules for visualization",
    )
    parser.add_argument(
        "directory",
        nargs="?",
        default=".",
        help=(
            "Data directory. Either a RuleSpec content root with "
            "`rulespec-<jurisdiction>/` subdirs, or a directory that has "
            "`rulespec/` as a sibling or child."
        ),
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("PORT", "5000")),
        help="Server port (default: 5000)",
    )
    parser.add_argument(
        "--no-open",
        action="store_true",
        help="Don't open browser automatically",
    )
    args = parser.parse_args()

    data_dir = Path(args.directory).resolve()
    if not data_dir.is_dir():
        print(f"Error: {data_dir} is not a directory")
        raise SystemExit(1)

    rulespec_root = _find_rulespec_root(data_dir)
    if rulespec_root is None:
        print(
            f"No RuleSpec content found under {data_dir} "
            f"(expected `rulespec-<jurisdiction>/` subdirs)"
        )
        raise SystemExit(1)

    rulesets: dict = {}
    for comp_path, ruleset_id in _find_rulespec_compositions(rulespec_root):
        try:
            model = parse_rulespec_composition(
                comp_path, str(rulespec_root), ruleset_id
            )
            # Allow per-ruleset references.json (sibling of the composition
            # file) to attach policy-doc citations onto nodes.
            resolve_references(model, str(comp_path.parent))
            rulesets[ruleset_id] = model
            set_ruleset_dir(ruleset_id, str(comp_path.parent))
            set_ruleset_composition(ruleset_id, str(comp_path))
            print(
                f'Loaded RuleSpec ruleset "{model["name"]}" '
                f'({len(model["nodes"])} nodes, root={rulespec_root})'
            )
        except Exception as e:
            print(f'Failed to parse RuleSpec composition {comp_path}: {e}')

    if not rulesets:
        print(f"No RuleSpec compositions found under {rulespec_root}")
        raise SystemExit(1)

    set_rulesets(rulesets)

    # Browser open
    if not args.no_open:
        webbrowser.open(f"http://localhost:{args.port}")

    # Start server (blocking)
    run_server(port=args.port)


if __name__ == "__main__":
    main()
