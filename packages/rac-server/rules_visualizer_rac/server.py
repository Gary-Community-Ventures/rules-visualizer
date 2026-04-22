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

# In-memory store: model dicts and compiled IRs
_rulesets: dict[str, dict] = {}
_compiled_irs: dict[str, Any] = {}
_ruleset_dirs: dict[str, str] = {}  # ruleset_id → directory path for recompilation

# WebSocket clients
_ws_clients: set[web.WebSocketResponse] = set()

# Event loop reference (set when server starts, used by watcher thread)
_loop: asyncio.AbstractEventLoop | None = None

PUBLIC_DIR = Path(__file__).parent.parent / "public"


def set_rulesets(rulesets: dict[str, dict]) -> None:
    global _rulesets
    _rulesets = rulesets


def set_compiled_ir(ruleset_id: str, ir: Any) -> None:
    """Store a compiled IR for a ruleset."""
    if ir is not None:
        _compiled_irs[ruleset_id] = ir
    else:
        _compiled_irs.pop(ruleset_id, None)


def set_ruleset_dir(ruleset_id: str, directory: str) -> None:
    """Store the data directory for a ruleset (used for recompilation)."""
    _ruleset_dirs[ruleset_id] = directory


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
    """GET /api/rulesets/:id/inputs — describe what inputs a ruleset accepts."""
    ruleset_id = request.match_info["id"]

    ir = _compiled_irs.get(ruleset_id)
    if ir is None:
        if ruleset_id not in _rulesets:
            return _json_response({"error": "Ruleset not found"}, status=404)
        return _json_response(
            {"executable": False, "scalars": [], "entities": {}}, status=200
        )

    scalars: list[dict[str, Any]] = []
    entities: dict[str, list[str]] = {}

    for var_path in ir.order:
        var = ir.variables[var_path]
        vd = var.model_dump()
        entity = vd.get("entity")
        expr = vd.get("expr")
        is_literal = expr is not None and expr.get("type") == "literal"
        is_leaf = is_literal or expr is None

        if entity:
            entities.setdefault(entity, []).append(var_path)
        elif is_leaf:
            info: dict[str, Any] = {"path": var_path}
            if vd.get("label"):
                info["label"] = vd["label"]
            if vd.get("unit"):
                info["unit"] = vd["unit"]
            if is_literal:
                info["default"] = _serialize_value(expr.get("value"))
            scalars.append(info)

    return _json_response(
        {"executable": True, "scalars": scalars, "entities": entities}
    )


async def handle_ruleset_execute(request: web.Request) -> web.Response:
    """POST /api/rulesets/:id/execute — execute rules with input data.

    Input format:
      {
        "inputs": {
          "scalar_path": value,         // override scalar constants
          ...
        },
        "entities": {                   // optional entity tables
          "TaxUnit": [{"id": 1, ...}],
          "Person":  [{"id": 1, "tax_unit_id": 1, ...}],
        }
      }
    """
    from rac import execute as rac_execute

    ruleset_id = request.match_info["id"]

    # Check ruleset exists
    if ruleset_id not in _rulesets:
        return _json_response({"error": "Ruleset not found"}, status=404)

    # Check we have a compiled IR
    ir = _compiled_irs.get(ruleset_id)
    if ir is None:
        return _json_response(
            {"error": "Ruleset could not be compiled; execution unavailable"},
            status=400,
        )

    # Parse request body
    try:
        body = await request.json()
    except (json.JSONDecodeError, Exception):
        return _json_response({"error": "Invalid JSON body"}, status=400)

    scalar_overrides: dict[str, Any] = body.get("inputs", {})
    entity_tables: dict[str, list[dict[str, Any]]] = body.get("entities", {})
    as_of_str: str | None = body.get("as_of")

    # If a custom as_of date is provided, recompile the IR for that date
    import copy
    from rac.executor import Executor, Context, evaluate, Data

    effective_ir = ir
    if as_of_str:
        try:
            from datetime import date as date_cls

            as_of = date_cls.fromisoformat(as_of_str)
            rac_dir = _ruleset_dirs.get(ruleset_id)
            if rac_dir:
                from .parser import parse_rac_directory

                _, recompiled_ir = parse_rac_directory(
                    rac_dir, ruleset_id, as_of=as_of
                )
                if recompiled_ir:
                    effective_ir = recompiled_ir
        except Exception as e:
            print(f"  Warning: recompile for as_of={as_of_str} failed: {e}")

    # Execute using a custom approach that handles input variables
    # the compiler drops. We pre-populate the executor context with
    # user-provided input values and constant overrides.
    try:
        patched_ir = copy.deepcopy(effective_ir) if scalar_overrides else effective_ir

        # Patch constant overrides into the IR's literal expressions
        for var_path, value in scalar_overrides.items():
            if var_path in patched_ir.variables:
                var = patched_ir.variables[var_path]
                vd = var.model_dump()
                expr = vd.get("expr")
                if expr and expr.get("type") == "literal":
                    var.expr.value = value

        # Build executor and context manually so we can inject inputs
        executor = Executor(patched_ir)
        data = Data(tables=entity_tables) if entity_tables else Data(tables={})
        ctx = Context(data=data)

        # Pre-populate context with default values for SCALAR input variables
        # the compiler dropped (no temporal expression).  Skip entity-scoped
        # inputs — those come from entity data rows, not ctx.computed.
        model = _rulesets.get(ruleset_id, {})
        for node in model.get("nodes", {}).values():
            c = node.get("content", {})
            if c.get("role") != "input":
                continue
            if c.get("entity"):
                continue  # entity-scoped inputs come from row data
            var_path = c.get("path")
            if not var_path or var_path in patched_ir.variables:
                continue
            # Parse the stored default into an appropriate Python value
            raw = c.get("default")
            ctx.computed[var_path] = _parse_default(raw)

        # Overlay user-provided values (inputs, constant overrides, and pinned nodes)
        for var_path, value in scalar_overrides.items():
            ctx.computed[var_path] = value

        # Run the executor's logic (replicated from Executor.execute).
        # Skip any variable already in ctx.computed (pinned by user).
        #
        # Two-pass approach:
        # Pass 1: Evaluate scalars that don't need entity data, and all entity vars.
        #         Entity result lists are NOT put into ctx.computed during this pass
        #         because [False] is truthy in Python and would break conditions.
        # Pass 2: Inject entity result lists, then evaluate remaining scalars
        #         that aggregate over entity data (sum, max, etc.).
        entities: dict[str, dict[str, list]] = {}
        deferred_scalars: list[str] = []

        for path in patched_ir.order:
            var = patched_ir.variables[path]
            if var.entity is None:
                if path not in ctx.computed:
                    try:
                        ctx.computed[path] = evaluate(var.expr, ctx)
                    except Exception:
                        # May fail if it references entity results not yet available
                        deferred_scalars.append(path)
            else:
                entity_name = var.entity
                rows = data.get_rows(entity_name)
                if entity_name not in entities:
                    entities[entity_name] = {}
                entities[entity_name][path] = []
                for i, row in enumerate(rows):
                    augmented = dict(row)
                    for prev_path, prev_vals in entities.get(entity_name, {}).items():
                        if len(prev_vals) > i:
                            augmented[prev_path] = prev_vals[i]
                    ctx.current_row = augmented
                    ctx.current_entity = entity_name
                    val = evaluate(var.expr, ctx)
                    entities[entity_name][path].append(val)
                    ctx.current_row = None
                    ctx.current_entity = None

        # Pass 2: Inject entity result lists for aggregation, then eval deferred scalars
        for entity_name, fields in entities.items():
            for path, values in fields.items():
                ctx.computed[path] = values

        for path in deferred_scalars:
            if path not in ctx.computed:
                ctx.computed[path] = evaluate(
                    patched_ir.variables[path].expr, ctx
                )

        # Build result
        from rac.executor import Result
        result = Result(scalars=ctx.computed, entities=entities)

    except Exception as e:
        return _json_response({"error": f"Execution failed: {e}"}, status=500)

    # Build path->node_id map from the stored model
    model = _rulesets[ruleset_id]
    path_to_node_id: dict[str, str] = {}
    for node_id, node in model.get("nodes", {}).items():
        content = node.get("content", {})
        var_path = content.get("path")
        if var_path:
            path_to_node_id[var_path] = node_id

    # Map results back to node IDs
    results: dict[str, dict[str, Any]] = {}

    # Scalar results
    for var_path, value in result.scalars.items():
        node_id = path_to_node_id.get(var_path)
        if node_id:
            results[node_id] = {"value": _serialize_value(value)}

    # Entity results
    for entity_name, fields in result.entities.items():
        for var_path, values in fields.items():
            node_id = path_to_node_id.get(var_path)
            if node_id:
                results[node_id] = {
                    "value": [_serialize_value(v) for v in values],
                    "entity": entity_name,
                }

    return _json_response({"results": results})


# --- Helpers ---


def _parse_default(raw: Any) -> Any:
    """Convert a stored default string to a Python value for execution."""
    if raw is None:
        return 0
    if isinstance(raw, (int, float, bool)):
        return raw
    s = str(raw).strip().lower()
    if s in ("false", "no"):
        return False
    if s in ("true", "yes"):
        return True
    try:
        return int(raw)
    except (ValueError, TypeError):
        pass
    try:
        return float(raw)
    except (ValueError, TypeError):
        pass
    return 0


def _serialize_value(value: Any) -> Any:
    """Make a value JSON-serializable."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, list):
        return [_serialize_value(v) for v in value]
    if isinstance(value, dict):
        return {k: _serialize_value(v) for k, v in value.items()}
    # Fallback: convert to string
    return str(value)


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


def _compare_values(expected: Any, actual: Any, tolerance: float = 0.01) -> bool:
    if expected == actual:
        return True
    if expected is None or actual is None:
        return False
    if isinstance(expected, bool) or isinstance(actual, bool):
        return expected == actual
    if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
        return abs(float(expected) - float(actual)) <= tolerance
    if isinstance(expected, list) and isinstance(actual, list):
        if len(expected) != len(actual):
            return False
        return all(_compare_values(e, a, tolerance) for e, a in zip(expected, actual))
    return str(expected) == str(actual)


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
    """Run tests for a ruleset and compare expectations."""
    ruleset_id = request.match_info["id"]
    if ruleset_id not in _rulesets:
        return _json_response({"error": "Ruleset not found"}, status=404)

    ir = _compiled_irs.get(ruleset_id)
    if ir is None:
        return _json_response({"error": "Ruleset not compilable"}, status=400)

    body = await request.json() if request.can_read_body else {}
    test_ids = body.get("testIds")
    tests = _read_tests(ruleset_id)
    if test_ids:
        tests = [t for t in tests if t["id"] in test_ids]

    results = []
    for test in tests:
        try:
            # Build a fake request-like execute call
            as_of_str = test.get("asOf")
            scalar_inputs = {**(test.get("inputs") or {}), **(test.get("overrides") or {})}
            entity_tables = test.get("entities") or {}

            # Recompile if as_of is specified
            effective_ir = ir
            if as_of_str:
                try:
                    from datetime import date as date_cls
                    as_of = date_cls.fromisoformat(as_of_str)
                    rac_dir = _ruleset_dirs.get(ruleset_id)
                    if rac_dir:
                        from .parser import parse_rac_directory
                        _, recompiled = parse_rac_directory(rac_dir, ruleset_id, as_of=as_of)
                        if recompiled:
                            effective_ir = recompiled
                except Exception:
                    pass

            # Execute (reuse the same logic as handle_ruleset_execute)
            import copy
            from rac.executor import Context, evaluate, Data
            from rac.schema import Data as SchemaData

            patched_ir = copy.deepcopy(effective_ir) if scalar_inputs else effective_ir
            for var_path, value in scalar_inputs.items():
                if var_path in patched_ir.variables:
                    var = patched_ir.variables[var_path]
                    vd = var.model_dump()
                    expr = vd.get("expr")
                    if expr and expr.get("type") == "literal":
                        var.expr.value = value

            data = SchemaData(tables=entity_tables) if entity_tables else SchemaData(tables={})
            ctx = Context(data=data)

            model = _rulesets.get(ruleset_id, {})
            for node in model.get("nodes", {}).values():
                c = node.get("content", {})
                if c.get("role") != "input":
                    continue
                if c.get("entity"):
                    continue
                var_path = c.get("path")
                if not var_path or var_path in patched_ir.variables:
                    continue
                raw = c.get("default")
                ctx.computed[var_path] = _parse_default(raw)

            for var_path, value in scalar_inputs.items():
                ctx.computed[var_path] = value

            entities: dict[str, dict[str, list]] = {}
            deferred_scalars: list[str] = []
            for path in patched_ir.order:
                var = patched_ir.variables[path]
                if var.entity is None:
                    if path not in ctx.computed:
                        try:
                            ctx.computed[path] = evaluate(var.expr, ctx)
                        except Exception:
                            deferred_scalars.append(path)
                else:
                    entity_name = var.entity
                    rows = data.get_rows(entity_name)
                    if entity_name not in entities:
                        entities[entity_name] = {}
                    entities[entity_name][path] = []
                    for i, row in enumerate(rows):
                        augmented = dict(row)
                        for prev_path, prev_vals in entities.get(entity_name, {}).items():
                            if len(prev_vals) > i:
                                augmented[prev_path] = prev_vals[i]
                        ctx.current_row = augmented
                        ctx.current_entity = entity_name
                        val = evaluate(var.expr, ctx)
                        entities[entity_name][path].append(val)
                        ctx.current_row = None
                        ctx.current_entity = None

            for entity_name, fields in entities.items():
                for path, values in fields.items():
                    ctx.computed[path] = values
            for path in deferred_scalars:
                if path not in ctx.computed:
                    ctx.computed[path] = evaluate(patched_ir.variables[path].expr, ctx)

            # Build path results (scalars + entity arrays)
            path_results: dict[str, Any] = {}
            for path, value in ctx.computed.items():
                path_results[path] = _serialize_value(value)
            for entity_name, fields in entities.items():
                for path, values in fields.items():
                    path_results[path] = [_serialize_value(v) for v in values]

            # Compare expectations
            expectations: dict[str, dict[str, Any]] = {}
            all_passed = True
            for expect_path, expected_value in test.get("expect", {}).items():
                actual = path_results.get(expect_path)
                passed = _compare_values(expected_value, actual)
                expectations[expect_path] = {
                    "expected": expected_value,
                    "actual": actual,
                    "passed": passed,
                }
                if not passed:
                    all_passed = False

            results.append({
                "testId": test["id"],
                "name": test["name"],
                "passed": all_passed,
                "expectations": expectations,
                "computedValues": path_results,
            })
        except Exception as e:
            results.append({
                "testId": test["id"],
                "name": test["name"],
                "passed": False,
                "error": str(e),
                "expectations": {},
            })

    return _json_response({"results": results})


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
    # Reload model so nodes get updated references
    rac_dir = _ruleset_dirs.get(ruleset_id)
    if rac_dir:
        try:
            from .parser import parse_rac_directory, resolve_references

            model, ir = parse_rac_directory(rac_dir, ruleset_id)
            resolve_references(model, rac_dir)
            _rulesets[ruleset_id] = model
            if ir:
                _compiled_irs[ruleset_id] = ir
        except Exception as e:
            print(f"  Warning: failed to reload model after reference save: {e}")
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
