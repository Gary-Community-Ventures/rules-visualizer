"""File watcher for .rac file changes."""

from __future__ import annotations

import time
from pathlib import Path
from threading import Thread

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileSystemEvent

from .parser import parse_rac_directory
from .server import set_rulesets, get_rulesets


class RacFileHandler(FileSystemEventHandler):
    """Watches for .rac file changes and reloads affected rulesets."""

    def __init__(self, data_dir: str) -> None:
        self.data_dir = Path(data_dir)

    def on_modified(self, event: FileSystemEvent) -> None:
        self._handle(event)

    def on_created(self, event: FileSystemEvent) -> None:
        self._handle(event)

    def _handle(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        path = Path(str(event.src_path))
        if path.suffix != ".rac":
            return

        # Determine which ruleset directory was affected
        try:
            relative = path.relative_to(self.data_dir)
            ruleset_id = relative.parts[0]
        except (ValueError, IndexError):
            return

        ruleset_dir = self.data_dir / ruleset_id
        print(f"File changed: {relative} — reloading ruleset '{ruleset_id}'")

        try:
            model = parse_rac_directory(str(ruleset_dir), ruleset_id)
            rulesets = get_rulesets()
            rulesets[ruleset_id] = model
            set_rulesets(rulesets)
            print(f"Reloaded '{ruleset_id}' ({len(model['nodes'])} nodes)")
        except Exception as e:
            print(f"Failed to reload '{ruleset_id}': {e}")


def start_watcher(data_dir: str) -> None:
    """Start watching a directory for .rac file changes."""
    handler = RacFileHandler(data_dir)
    observer = Observer()
    observer.schedule(handler, data_dir, recursive=True)
    observer.daemon = True
    observer.start()
    print(f"Watching {data_dir} for .rac changes...")
