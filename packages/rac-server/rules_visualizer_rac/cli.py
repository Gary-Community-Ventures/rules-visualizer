"""CLI entry point for the RAC rules visualizer server."""

from __future__ import annotations

import argparse
import os
import webbrowser
from pathlib import Path

from .parser import parse_rac_directory
from .server import set_rulesets, run_server
from .watcher import start_watcher


def main() -> None:
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
                model = parse_rac_directory(str(subdir), ruleset_id)
                rulesets[ruleset_id] = model
                print(
                    f'Loaded ruleset "{model["name"]}" '
                    f'({len(model["nodes"])} nodes from {len(rac_files)} files)'
                )
            except Exception as e:
                print(f'Failed to parse ruleset "{ruleset_id}": {e}')
    else:
        # Flat directory — treat as single ruleset
        rac_files = list(data_dir.rglob("*.rac"))
        if rac_files:
            ruleset_id = data_dir.name
            try:
                model = parse_rac_directory(str(data_dir), ruleset_id)
                rulesets[ruleset_id] = model
                print(
                    f'Loaded ruleset "{model["name"]}" '
                    f'({len(model["nodes"])} nodes from {len(rac_files)} files)'
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
