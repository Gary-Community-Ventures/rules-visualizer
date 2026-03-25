"""HTTP + WebSocket server for the RAC rules visualizer."""

from __future__ import annotations

import asyncio
import json
import mimetypes
from http import HTTPStatus
from pathlib import Path
from typing import Any

import websockets
import websockets.http11
import websockets.datastructures
from websockets.asyncio.server import ServerConnection, Server

# In-memory store
_rulesets: dict[str, dict] = {}

# WebSocket clients
_ws_clients: set[ServerConnection] = set()

# Event loop reference (set when server starts, used by watcher thread)
_loop: asyncio.AbstractEventLoop | None = None

PUBLIC_DIR = Path(__file__).parent.parent / "public"


def set_rulesets(rulesets: dict[str, dict]) -> None:
    global _rulesets
    _rulesets = rulesets


def get_rulesets() -> dict[str, dict]:
    return _rulesets


def broadcast_reload(ruleset_id: str | None = None) -> None:
    """Broadcast a reload message to all connected WebSocket clients.

    Safe to call from any thread (e.g. the file watcher thread).
    """
    if _loop is None:
        return
    msg = json.dumps({"type": "reload", "rulesetId": ruleset_id})

    async def _send_all() -> None:
        for ws in list(_ws_clients):
            try:
                await ws.send(msg)
            except Exception:
                pass

    _loop.call_soon_threadsafe(asyncio.ensure_future, _send_all())


async def _ws_handler(ws: ServerConnection) -> None:
    """Handle a WebSocket connection."""
    _ws_clients.add(ws)
    try:
        await ws.send(json.dumps({"type": "connected"}))
        async for _ in ws:
            pass  # We don't expect messages from the client
    finally:
        _ws_clients.discard(ws)


def _process_request(
    connection: ServerConnection,
    request: websockets.http11.Request,
) -> websockets.http11.Response | None:
    """Handle HTTP requests (API + static files).

    Returns a Response for HTTP requests, or None to proceed with WebSocket upgrade.
    """
    path = request.path

    # API routes
    if path == "/api/rulesets":
        summaries = [
            {"id": m["id"], "name": m["name"], "format": m["format"]}
            for m in _rulesets.values()
        ]
        return _json_response({"rulesets": summaries})

    if path.startswith("/api/rulesets/"):
        parts = path.split("/api/rulesets/", 1)[1].split("/")
        ruleset_id = parts[0]

        if len(parts) > 1 and parts[1] == "execute":
            return _json_response(
                {"error": "Execution not yet implemented"}, status=501
            )

        model = _rulesets.get(ruleset_id)
        if model:
            return _json_response(model)
        return _json_response({"error": "Ruleset not found"}, status=404)

    # WebSocket upgrade — return None to let websockets handle it
    if path == "/ws":
        return None

    # Static files
    if PUBLIC_DIR.exists():
        file_path = (PUBLIC_DIR / path.lstrip("/")).resolve()
        # Security: ensure resolved path is under PUBLIC_DIR
        if file_path.is_file() and str(file_path).startswith(str(PUBLIC_DIR.resolve())):
            return _file_response(file_path)
        # SPA fallback
        index = PUBLIC_DIR / "index.html"
        if index.is_file():
            return _file_response(index)

    return _json_response(
        {"error": "No frontend build found. Use Vite dev server."}, status=404
    )


def _json_response(data: Any, status: int = 200) -> websockets.http11.Response:
    body = json.dumps(data).encode("utf-8")
    headers = websockets.datastructures.Headers(
        {
            "Content-Type": "application/json",
            "Content-Length": str(len(body)),
            "Access-Control-Allow-Origin": "*",
        }
    )
    return websockets.http11.Response(HTTPStatus(status), "", headers, body)


def _file_response(file_path: Path) -> websockets.http11.Response:
    content_type, _ = mimetypes.guess_type(str(file_path))
    if content_type is None:
        content_type = "application/octet-stream"
    body = file_path.read_bytes()
    headers = websockets.datastructures.Headers(
        {
            "Content-Type": content_type,
            "Content-Length": str(len(body)),
        }
    )
    return websockets.http11.Response(HTTPStatus(200), "", headers, body)


async def _serve(port: int) -> None:
    global _loop
    _loop = asyncio.get_running_loop()

    async with websockets.serve(
        _ws_handler,
        "",
        port,
        process_request=_process_request,
    ):
        print(f"RAC server listening on http://localhost:{port}")
        if PUBLIC_DIR.exists():
            print(f"Serving frontend from {PUBLIC_DIR}")
        else:
            print("No frontend build found — use Vite dev server")
        await asyncio.get_running_loop().create_future()  # run forever


def run_server(port: int = 5000) -> None:
    """Start the HTTP + WebSocket server."""
    asyncio.run(_serve(port))
