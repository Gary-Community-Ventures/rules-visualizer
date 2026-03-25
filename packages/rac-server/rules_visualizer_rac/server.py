"""HTTP server for the RAC rules visualizer."""

from __future__ import annotations

import json
import asyncio
import os
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler
from typing import Any

# In-memory store
_rulesets: dict[str, dict] = {}

# WebSocket clients (populated if websockets is available)
_ws_clients: set = set()

PUBLIC_DIR = Path(__file__).parent.parent / "public"


def set_rulesets(rulesets: dict[str, dict]) -> None:
    """Update the in-memory ruleset store."""
    global _rulesets
    _rulesets = rulesets


def get_rulesets() -> dict[str, dict]:
    return _rulesets


class RulesHandler(SimpleHTTPRequestHandler):
    """Handles API routes and serves static frontend files."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        # Serve from the public directory if it exists
        directory = str(PUBLIC_DIR) if PUBLIC_DIR.exists() else "."
        super().__init__(*args, directory=directory, **kwargs)

    def do_GET(self) -> None:
        if self.path == "/api/rulesets":
            summaries = [
                {"id": m["id"], "name": m["name"], "format": m["format"]}
                for m in _rulesets.values()
            ]
            self._json_response({"rulesets": summaries})
        elif self.path.startswith("/api/rulesets/"):
            ruleset_id = self.path.split("/api/rulesets/")[1].split("/")[0]
            model = _rulesets.get(ruleset_id)
            if model:
                self._json_response(model)
            else:
                self._json_response({"error": "Ruleset not found"}, status=404)
        elif PUBLIC_DIR.exists():
            # Try static file, fall back to index.html for SPA routing
            file_path = PUBLIC_DIR / self.path.lstrip("/")
            if file_path.is_file():
                super().do_GET()
            else:
                self.path = "/index.html"
                super().do_GET()
        else:
            self._json_response(
                {"error": "No frontend build found. Use Vite dev server."},
                status=404,
            )

    def do_POST(self) -> None:
        if "/execute" in self.path:
            self._json_response(
                {"error": "Execution not yet implemented"},
                status=501,
            )
        else:
            self._json_response({"error": "Not found"}, status=404)

    def _json_response(self, data: Any, status: int = 200) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:
        # Quieter logging — only log errors
        if args and isinstance(args[0], str) and args[0].startswith("4"):
            super().log_message(format, *args)


def run_server(port: int = 5000) -> None:
    """Start the HTTP server."""
    server = HTTPServer(("", port), RulesHandler)
    print(f"RAC server listening on http://localhost:{port}")
    if PUBLIC_DIR.exists():
        print(f"Serving frontend from {PUBLIC_DIR}")
    else:
        print("No frontend build found — use Vite dev server")
    server.serve_forever()
