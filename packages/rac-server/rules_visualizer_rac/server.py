"""HTTP + WebSocket server for the RAC rules visualizer."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import mimetypes
import os
from pathlib import Path
from typing import Any

from aiohttp import web

# In-memory store: model dicts only. Old .rac path used to also keep a
# compiled IR per ruleset for execution; that's gone — the new
# axiom-rules-engine integration will reintroduce execution via its own
# subprocess-based client.
_rulesets: dict[str, dict] = {}
_ruleset_dirs: dict[str, str] = {}  # ruleset_id → entry directory (for references.json)
_ruleset_compositions: dict[str, str] = {}  # ruleset_id → entry composition YAML path (for re-compile)

# WebSocket clients
_ws_clients: set[web.WebSocketResponse] = set()

# Event loop reference (set when server starts, used by watcher thread)
_loop: asyncio.AbstractEventLoop | None = None

PUBLIC_DIR = Path(__file__).parent.parent / "public"


def set_rulesets(rulesets: dict[str, dict]) -> None:
    global _rulesets
    _rulesets = rulesets


def set_ruleset_dir(ruleset_id: str, directory: str) -> None:
    """Store the data directory for a ruleset (used for references.json lookup)."""
    _ruleset_dirs[ruleset_id] = directory


def set_ruleset_composition(ruleset_id: str, composition_path: str) -> None:
    """Store the RuleSpec composition entrypoint for a ruleset (used by
    the axiom-rules-engine subprocess wrapper to compile on demand)."""
    _ruleset_compositions[ruleset_id] = composition_path


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
                await ws.send_str(msg)
            except Exception:
                pass

    _loop.call_soon_threadsafe(asyncio.ensure_future, _send_all())


# --- Route handlers ---


async def handle_ws(request: web.Request) -> web.WebSocketResponse:
    """Handle WebSocket connections at /ws."""
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    _ws_clients.add(ws)
    try:
        await ws.send_str(json.dumps({"type": "connected"}))
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                    if data.get("type") == "ai-chat":
                        asyncio.ensure_future(_handle_ai_chat(ws, data))
                except (json.JSONDecodeError, Exception):
                    pass
    finally:
        _ws_clients.discard(ws)
    return ws


async def _handle_ai_chat(ws: web.WebSocketResponse, data: dict) -> None:
    """Handle an AI chat request over WebSocket."""
    from rules_visualizer_rac.ai.agents.orchestrator import stream_agent
    from rules_visualizer_rac.ai.config import ChatContext

    request_id = data.get("requestId", "")
    ruleset_id = data.get("rulesetId", "")
    message = data.get("message", "")
    history = data.get("history")
    password = data.get("password")

    # In production, require AI_PASSWORD to be set and matched (constant-time comparison)
    required_password = os.environ.get("AI_PASSWORD")
    if required_password and not hmac.compare_digest(
        hashlib.sha256((password or "").encode()).digest(),
        hashlib.sha256(required_password.encode()).digest(),
    ):
        await ws.send_str(json.dumps({
            "type": "ai-error",
            "requestId": request_id,
            "content": "Invalid AI password",
        }))
        return

    try:
        async for event in stream_agent(
            ChatContext(ruleset_id=ruleset_id),
            message,
            thread_id=request_id,
            history=history,
        ):
            event["requestId"] = request_id
            event_type = event.pop("type")
            # Map event types to match frontend expectations
            type_map = {
                "text": "ai-chunk",
                "tool_start": "ai-tool-start",
                "tool_end": "ai-tool-end",
                "done": "ai-done",
                "error": "ai-error",
            }
            ws_type = type_map.get(event_type, f"ai-{event_type}")
            await ws.send_str(json.dumps({"type": ws_type, **event}))
    except Exception as e:
        await ws.send_str(json.dumps({
            "type": "ai-error",
            "requestId": request_id,
            "content": str(e),
        }))


async def handle_rulesets_list(request: web.Request) -> web.Response:
    """GET /api/rulesets — list all rulesets."""
    summaries = [
        {"id": m["id"], "name": m["name"], "format": m["format"]}
        for m in _rulesets.values()
    ]
    return _json_response({"rulesets": summaries})


async def handle_ruleset_get(request: web.Request) -> web.Response:
    """GET /api/rulesets/:id — get a single ruleset."""
    ruleset_id = request.match_info["id"]
    model = _rulesets.get(ruleset_id)
    if model:
        return _json_response(model)
    return _json_response({"error": "Ruleset not found"}, status=404)


async def handle_ruleset_inputs(request: web.Request) -> web.Response:
    """GET /api/rulesets/:id/inputs — describe what inputs a ruleset accepts.

    Always returns `executable: false` since the old `.rac` execution path
    is removed and the new axiom-rules-engine isn't wired up yet.
    """
    ruleset_id = request.match_info["id"]
    if ruleset_id not in _rulesets:
        return _json_response({"error": "Ruleset not found"}, status=404)
    return _json_response(
        {"executable": False, "scalars": [], "entities": {}}, status=200
    )


async def handle_ruleset_execute(request: web.Request) -> web.Response:
    """POST /api/rulesets/:id/execute — execute rules with input data.

    Body:
      {
        "inputs": {"varName": value, ...},     # bare-name overrides
        "entities": {"members": [...]},        # optional, currently unused
        "as_of": "YYYY-MM-DD"                  # optional, defaults to 2026-01
      }

    Returns: {results: {nodeId: {value}}}. Inputs not provided are defaulted
    to zero values (false for Judgment, 0 for Money/Integer/Rate, etc.).
    """
    from .axiom_engine import execute as axiom_execute

    ruleset_id = request.match_info["id"]
    if ruleset_id not in _rulesets:
        return _json_response({"error": "Ruleset not found"}, status=404)

    composition_path = _ruleset_compositions.get(ruleset_id)
    if not composition_path:
        return _json_response(
            {"error": "No RuleSpec composition recorded for this ruleset"},
            status=400,
        )

    try:
        body = await request.json()
    except Exception:
        body = {}

    user_inputs = body.get("inputs") or {}
    entities = body.get("entities") or {}
    as_of = body.get("as_of") or "2026-01-15"
    # Derive a month-aligned period from as_of.
    period_start = f"{as_of[:7]}-01"
    period_end = _last_day_of_month(period_start)

    try:
        results = axiom_execute(
            ruleset_id,
            composition_path,
            _rulesets[ruleset_id],
            user_inputs=user_inputs,
            entities=entities,
            period_start=period_start,
            period_end=period_end,
        )
    except FileNotFoundError as e:
        return _json_response({"error": str(e)}, status=503)
    except RuntimeError as e:
        return _json_response({"error": str(e)}, status=400)
    except Exception as e:
        return _json_response(
            {"error": f"Execution failed: {e}"}, status=500
        )

    return _json_response({"results": results})


def _last_day_of_month(date_str: str) -> str:
    """`2026-01-01` → `2026-01-31`. Cheap month-end calc."""
    from calendar import monthrange
    from datetime import date as date_cls

    d = date_cls.fromisoformat(date_str)
    last = monthrange(d.year, d.month)[1]
    return d.replace(day=last).isoformat()


# --- Helpers ---


def _json_response(data: Any, status: int = 200) -> web.Response:
    return web.Response(
        text=json.dumps(data),
        status=status,
        content_type="application/json",
        headers={"Access-Control-Allow-Origin": "*"},
    )


@web.middleware
async def basic_auth_middleware(request: web.Request, handler: Any) -> web.Response:
    """Require basic auth when BASIC_AUTH_USER and BASIC_AUTH_PASS are set."""
    required_user = os.environ.get("BASIC_AUTH_USER")
    required_pass = os.environ.get("BASIC_AUTH_PASS")
    if not required_user or not required_pass:
        return await handler(request)

    header = request.headers.get("Authorization", "")
    if not header.startswith("Basic "):
        return web.Response(
            status=401,
            text="Authentication required",
            headers={"WWW-Authenticate": 'Basic realm="Rules Visualizer"'},
        )
    decoded = base64.b64decode(header[6:]).decode("utf-8", errors="replace")
    user, _, password = decoded.partition(":")
    user_match = hmac.compare_digest(
        hashlib.sha256(user.encode()).digest(),
        hashlib.sha256(required_user.encode()).digest(),
    )
    pass_match = hmac.compare_digest(
        hashlib.sha256(password.encode()).digest(),
        hashlib.sha256(required_pass.encode()).digest(),
    )
    if not user_match or not pass_match:
        return web.Response(
            status=401,
            text="Invalid credentials",
            headers={"WWW-Authenticate": 'Basic realm="Rules Visualizer"'},
        )
    return await handler(request)


@web.middleware
async def cors_middleware(request: web.Request, handler: Any) -> web.Response:
    """Handle CORS preflight and add CORS headers to all responses."""
    if request.method == "OPTIONS":
        return web.Response(
            status=204,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            },
        )
    response = await handler(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response


# --- Test CRUD + runner ---


def _tests_path(ruleset_id: str) -> Path | None:
    rac_dir = _ruleset_dirs.get(ruleset_id)
    if not rac_dir:
        return None
    return Path(rac_dir) / "tests.json"


def _read_tests(ruleset_id: str) -> list[dict]:
    p = _tests_path(ruleset_id)
    if not p or not p.exists():
        return []
    try:
        return json.loads(p.read_text())
    except Exception:
        return []


def _write_tests(ruleset_id: str, tests: list[dict]) -> None:
    p = _tests_path(ruleset_id)
    if p:
        p.write_text(json.dumps(tests, indent=2))


async def handle_tests_list(request: web.Request) -> web.Response:
    ruleset_id = request.match_info["id"]
    if ruleset_id not in _rulesets:
        return _json_response({"error": "Ruleset not found"}, status=404)
    return _json_response({"tests": _read_tests(ruleset_id)})


async def handle_tests_create(request: web.Request) -> web.Response:
    ruleset_id = request.match_info["id"]
    if ruleset_id not in _rulesets:
        return _json_response({"error": "Ruleset not found"}, status=404)
    body = await request.json()
    import uuid

    tests = _read_tests(ruleset_id)
    new_test = {
        "id": str(uuid.uuid4()),
        "name": body.get("name", "Untitled test"),
        "description": body.get("description"),
        "asOf": body.get("asOf"),
        "inputs": body.get("inputs", {}),
        "entities": body.get("entities"),
        "overrides": body.get("overrides"),
        "expect": body.get("expect", {}),
    }
    tests.append(new_test)
    _write_tests(ruleset_id, tests)
    return _json_response(new_test)


async def handle_tests_update(request: web.Request) -> web.Response:
    ruleset_id = request.match_info["id"]
    test_id = request.match_info["testId"]
    tests = _read_tests(ruleset_id)
    body = await request.json()
    for i, t in enumerate(tests):
        if t["id"] == test_id:
            tests[i] = {**t, **body, "id": test_id}
            _write_tests(ruleset_id, tests)
            return _json_response(tests[i])
    return _json_response({"error": "Test not found"}, status=404)


async def handle_tests_delete(request: web.Request) -> web.Response:
    ruleset_id = request.match_info["id"]
    test_id = request.match_info["testId"]
    tests = _read_tests(ruleset_id)
    before = len(tests)
    tests = [t for t in tests if t["id"] != test_id]
    if len(tests) == before:
        return _json_response({"error": "Test not found"}, status=404)
    _write_tests(ruleset_id, tests)
    return _json_response({"success": True})


async def handle_tests_run(request: web.Request) -> web.Response:
    """POST /api/rulesets/:id/tests/run — run tests.

    Same status as `handle_ruleset_execute` — gated on the axiom-rules-engine
    integration. Test CRUD (list/create/update/delete) still works; only
    actually executing them is blocked.
    """
    ruleset_id = request.match_info["id"]
    if ruleset_id not in _rulesets:
        return _json_response({"error": "Ruleset not found"}, status=404)
    return _json_response(
        {
            "error": (
                "Test execution not implemented. The legacy .rac executor "
                "was removed; axiom-rules-engine wiring will restore this."
            )
        },
        status=501,
    )


# --- Policy references CRUD ---


def _refs_path(ruleset_id: str) -> Path | None:
    rac_dir = _ruleset_dirs.get(ruleset_id)
    if not rac_dir:
        return None
    return Path(rac_dir) / "references.json"


def _read_refs(ruleset_id: str) -> dict:
    p = _refs_path(ruleset_id)
    if not p or not p.exists():
        return {"documents": [], "sections": [], "mappings": []}
    try:
        return json.loads(p.read_text())
    except Exception:
        return {"documents": [], "sections": [], "mappings": []}


def _write_refs(ruleset_id: str, refs: dict) -> None:
    p = _refs_path(ruleset_id)
    if p:
        p.write_text(json.dumps(refs, indent=2) + "\n")


async def handle_refs_get(request: web.Request) -> web.Response:
    ruleset_id = request.match_info["id"]
    if ruleset_id not in _rulesets:
        return _json_response({"error": "Ruleset not found"}, status=404)
    return _json_response(_read_refs(ruleset_id))


async def handle_refs_put(request: web.Request) -> web.Response:
    ruleset_id = request.match_info["id"]
    if ruleset_id not in _rulesets:
        return _json_response({"error": "Ruleset not found"}, status=404)
    body = await request.json()
    if not isinstance(body.get("documents"), list) or not isinstance(
        body.get("sections"), list
    ) or not isinstance(body.get("mappings"), list):
        return _json_response({"error": "Invalid references format"}, status=400)
    _write_refs(ruleset_id, body)
    # Re-resolve references against the in-memory model. Cheap — just walks
    # the existing nodes attaching the new {section, document} entries.
    rac_dir = _ruleset_dirs.get(ruleset_id)
    if rac_dir:
        try:
            from .references import resolve_references

            # Clear stale `references` lists, then re-attach from the new file.
            model = _rulesets.get(ruleset_id) or {}
            for node in model.get("nodes", {}).values():
                node.pop("references", None)
            resolve_references(model, rac_dir)
        except Exception as e:
            print(f"  Warning: failed to refresh references in-place: {e}")
    return _json_response(body)


async def handle_refs_file(request: web.Request) -> web.Response:
    """GET /api/rulesets/:id/references/files/:filename — serve a policy document file."""
    ruleset_id = request.match_info["id"]
    filename = request.match_info["filename"]
    if ruleset_id not in _rulesets:
        return _json_response({"error": "Ruleset not found"}, status=404)
    rac_dir = _ruleset_dirs.get(ruleset_id)
    if not rac_dir:
        return _json_response({"error": "No data directory"}, status=500)

    # Prevent path traversal
    safe_name = Path(filename).name
    file_path = Path(rac_dir) / safe_name
    if not file_path.is_file():
        return _json_response({"error": "File not found"}, status=404)

    content_types = {
        ".pdf": "application/pdf",
        ".txt": "text/plain",
        ".md": "text/markdown",
    }
    ct = content_types.get(file_path.suffix.lower(), "application/octet-stream")
    return web.FileResponse(file_path, headers={"Content-Type": ct})


# --- Profiles CRUD (saved input/override/entity snapshots) ---


def _profiles_path(ruleset_id: str) -> Path | None:
    rac_dir = _ruleset_dirs.get(ruleset_id)
    if not rac_dir:
        return None
    return Path(rac_dir) / "profiles.json"


def _read_profiles(ruleset_id: str) -> list[dict]:
    p = _profiles_path(ruleset_id)
    if not p or not p.exists():
        return []
    try:
        return json.loads(p.read_text())
    except Exception:
        return []


def _write_profiles(ruleset_id: str, profiles: list[dict]) -> None:
    p = _profiles_path(ruleset_id)
    if p:
        p.write_text(json.dumps(profiles, indent=2) + "\n")


def _writes_blocked() -> bool:
    return os.environ.get("ALLOW_WRITES") != "1"


_PROFILES_READ_ONLY_MSG = "Profiles are read-only (ALLOW_WRITES is not set)"


async def handle_profiles_list(request: web.Request) -> web.Response:
    ruleset_id = request.match_info["id"]
    if ruleset_id not in _rulesets:
        return _json_response({"error": "Ruleset not found"}, status=404)
    return _json_response({"profiles": _read_profiles(ruleset_id)})


async def handle_profiles_create(request: web.Request) -> web.Response:
    if _writes_blocked():
        return _json_response({"error": _PROFILES_READ_ONLY_MSG}, status=403)
    ruleset_id = request.match_info["id"]
    if ruleset_id not in _rulesets:
        return _json_response({"error": "Ruleset not found"}, status=404)
    body = await request.json()
    import uuid as _uuid
    now = _now_iso()
    new_profile = {
        "id": str(_uuid.uuid4()),
        "name": body.get("name") or "Untitled profile",
        "description": body.get("description"),
        "asOf": body.get("asOf"),
        "inputs": body.get("inputs"),
        "overrides": body.get("overrides"),
        "entities": body.get("entities"),
        "createdAt": now,
        "updatedAt": now,
    }
    profiles = _read_profiles(ruleset_id)
    profiles.append(new_profile)
    _write_profiles(ruleset_id, profiles)
    return _json_response(new_profile)


async def handle_profiles_update(request: web.Request) -> web.Response:
    if _writes_blocked():
        return _json_response({"error": _PROFILES_READ_ONLY_MSG}, status=403)
    profile_id = request.match_info["profileId"]
    ruleset_id = request.match_info["id"]
    profiles = _read_profiles(ruleset_id)
    idx = next(
        (i for i, p in enumerate(profiles) if p.get("id") == profile_id),
        -1,
    )
    if idx == -1:
        return _json_response({"error": "Profile not found"}, status=404)
    body = await request.json()
    existing = profiles[idx]
    profiles[idx] = {
        **existing,
        **body,
        "id": profile_id,
        "createdAt": existing.get("createdAt"),
        "updatedAt": _now_iso(),
    }
    _write_profiles(ruleset_id, profiles)
    return _json_response(profiles[idx])


async def handle_profiles_delete(request: web.Request) -> web.Response:
    if _writes_blocked():
        return _json_response({"error": _PROFILES_READ_ONLY_MSG}, status=403)
    profile_id = request.match_info["profileId"]
    ruleset_id = request.match_info["id"]
    profiles = _read_profiles(ruleset_id)
    before = len(profiles)
    profiles = [p for p in profiles if p.get("id") != profile_id]
    if len(profiles) == before:
        return _json_response({"error": "Profile not found"}, status=404)
    _write_profiles(ruleset_id, profiles)
    return _json_response({"success": True})


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _create_app() -> web.Application:
    """Create the aiohttp application with all routes."""
    app = web.Application(middlewares=[basic_auth_middleware, cors_middleware])

    # API routes
    app.router.add_get("/api/rulesets", handle_rulesets_list)
    app.router.add_get("/api/rulesets/{id}", handle_ruleset_get)
    app.router.add_get("/api/rulesets/{id}/inputs", handle_ruleset_inputs)
    app.router.add_post("/api/rulesets/{id}/execute", handle_ruleset_execute)

    # Tests
    app.router.add_get("/api/rulesets/{id}/tests", handle_tests_list)
    app.router.add_post("/api/rulesets/{id}/tests", handle_tests_create)
    app.router.add_put("/api/rulesets/{id}/tests/{testId}", handle_tests_update)
    app.router.add_delete(
        "/api/rulesets/{id}/tests/{testId}", handle_tests_delete
    )
    app.router.add_post("/api/rulesets/{id}/tests/run", handle_tests_run)

    # References
    app.router.add_get("/api/rulesets/{id}/references", handle_refs_get)
    app.router.add_put("/api/rulesets/{id}/references", handle_refs_put)
    app.router.add_get(
        "/api/rulesets/{id}/references/files/{filename}", handle_refs_file
    )

    # Profiles
    app.router.add_get("/api/rulesets/{id}/profiles", handle_profiles_list)
    app.router.add_post("/api/rulesets/{id}/profiles", handle_profiles_create)
    app.router.add_put(
        "/api/rulesets/{id}/profiles/{profileId}", handle_profiles_update
    )
    app.router.add_delete(
        "/api/rulesets/{id}/profiles/{profileId}", handle_profiles_delete
    )

    # WebSocket
    app.router.add_get("/ws", handle_ws)

    # Static files (SPA with fallback)
    if PUBLIC_DIR.exists():
        # Serve static files, with SPA index.html fallback
        app.router.add_get("/{path:.*}", _handle_static)

    return app


async def _handle_static(request: web.Request) -> web.Response:
    """Serve static files with SPA fallback."""
    rel_path = request.match_info.get("path", "")
    file_path = (PUBLIC_DIR / rel_path).resolve()

    # Security: ensure resolved path is under PUBLIC_DIR
    if file_path.is_file() and str(file_path).startswith(str(PUBLIC_DIR.resolve())):
        content_type, _ = mimetypes.guess_type(str(file_path))
        if content_type is None:
            content_type = "application/octet-stream"
        return web.Response(
            body=file_path.read_bytes(),
            content_type=content_type,
        )

    # SPA fallback
    index = PUBLIC_DIR / "index.html"
    if index.is_file():
        return web.Response(
            body=index.read_bytes(),
            content_type="text/html",
        )

    return _json_response(
        {"error": "No frontend build found. Use Vite dev server."}, status=404
    )


async def _serve(port: int) -> None:
    global _loop
    _loop = asyncio.get_running_loop()

    app = _create_app()
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "", port)
    await site.start()

    print(f"RAC server listening on http://localhost:{port}")
    if PUBLIC_DIR.exists():
        print(f"Serving frontend from {PUBLIC_DIR}")
    else:
        print("No frontend build found — use Vite dev server")

    await asyncio.get_running_loop().create_future()  # run forever


def run_server(port: int = 5000) -> None:
    """Start the HTTP + WebSocket server."""
    asyncio.run(_serve(port))
