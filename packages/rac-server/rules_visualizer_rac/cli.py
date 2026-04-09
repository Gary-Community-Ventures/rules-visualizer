"""CLI entry point for the RAC rules visualizer server."""

from __future__ import annotations

import argparse
import os
import webbrowser
from pathlib import Path

from .parser import parse_rac_directory
from .server import set_rulesets, set_compiled_ir, set_ruleset_dir, run_server
from .watcher import start_watcher


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


def main() -> None:
    _load_env()
    parser = argparse.ArgumentParser(
        description="Serve RAC rules for visualization",
    )
    parser.add_argument(
        "directory",
        nargs="?",
        default=".",
        help="Directory containing .rac files (subdirectories become rulesets)",
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

    # Load all rulesets
    rulesets: dict = {}
    subdirs = [d for d in sorted(data_dir.iterdir()) if d.is_dir()]

    if subdirs:
        # Each subdirectory is a ruleset
        for subdir in subdirs:
            rac_files = list(subdir.rglob("*.rac"))
            if not rac_files:
                continue
            ruleset_id = subdir.name
            try:
                model, ir = parse_rac_directory(str(subdir), ruleset_id)
                rulesets[ruleset_id] = model
                set_compiled_ir(ruleset_id, ir)
                set_ruleset_dir(ruleset_id, str(subdir))
                print(
                    f'Loaded ruleset "{model["name"]}" '
                    f'({len(model["nodes"])} nodes from {len(rac_files)} files)'
                    f'{" [executable]" if ir else ""}'
                )
            except Exception as e:
                print(f'Failed to parse ruleset "{ruleset_id}": {e}')
    else:
        # Flat directory — treat as single ruleset
        rac_files = list(data_dir.rglob("*.rac"))
        if rac_files:
            ruleset_id = data_dir.name
            try:
                model, ir = parse_rac_directory(str(data_dir), ruleset_id)
                rulesets[ruleset_id] = model
                set_compiled_ir(ruleset_id, ir)
                set_ruleset_dir(ruleset_id, str(data_dir))
                print(
                    f'Loaded ruleset "{model["name"]}" '
                    f'({len(model["nodes"])} nodes from {len(rac_files)} files)'
                    f'{" [executable]" if ir else ""}'
                )
            except Exception as e:
                print(f"Failed to parse: {e}")

    if not rulesets:
        print(f"No .rac files found in {data_dir}")
        raise SystemExit(1)

    set_rulesets(rulesets)

    # Start file watcher
    start_watcher(str(data_dir))

    # Open browser
    if not args.no_open:
        webbrowser.open(f"http://localhost:{args.port}")

    # Start server (blocking)
    run_server(port=args.port)


if __name__ == "__main__":
    main()
