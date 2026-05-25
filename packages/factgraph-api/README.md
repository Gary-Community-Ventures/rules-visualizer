# rules-visualizer-factgraph-api

Partner-facing HTTP adapter for [Fact Graph](https://github.com/IRS-Public/direct-file)
rulesets. Exposes a small, ruleset-agnostic API for evaluating a fact-graph
target against partial input, with structured "missing inputs" feedback when
the target can't yet be determined.

This server is the integration point for external systems (caseworker tools,
screeners, eligibility blueprints) that want to consume rulesets defined in
this repo without binding to the visualizer's internals.

> **Prototype.** The API is under active development and not yet a production
> service. See `docs/changelog.md` for what's stable and what's still moving.

## Quick start (local)

```sh
npm install
npm run build:factgraph-api
npm run dev:api          # serves on http://localhost:5002 by default
```

The server loads every ruleset in `data/factgraph/` at startup. Hit any
endpoint with `curl` to confirm:

```sh
curl http://localhost:5002/health
curl http://localhost:5002/v1/factgraph/rulesets
```

Prefer a clickable UI? A [Bruno](https://www.usebruno.com/) collection
with working requests for every endpoint lives at
[`docs/bruno/`](docs/bruno/README.md). Install Bruno, open that folder,
click Send.

## Endpoints

| Method | Path                              | Purpose                                    |
| ------ | --------------------------------- | ------------------------------------------ |
| `GET`  | `/health`                         | Liveness probe — `{ "status": "ok" }`      |
| `GET`  | `/v1/factgraph/rulesets`          | List loaded rulesets                       |
| `GET`  | `/v1/factgraph/:rulesetId/schema` | Node definitions, types, citations         |
| `POST` | `/v1/factgraph/:rulesetId/query`  | Evaluate a target node with partial inputs |

The query endpoint is the centerpiece — see `docs/concepts.md` for the
incompleteness model and `docs/examples-snap.md` for a worked SNAP
walkthrough.

## Authentication

Set `API_BEARER_TOKEN` to require `Authorization: Bearer <token>` on every
`/v1/*` request. If unset, the API is open — appropriate for local
development and an early-prototype deploy where partner teams need an easy
on-ramp.

Tokens are compared with `timingSafeEqual` to avoid leaking validation
latency.

## CORS

By default, all origins are allowed. To restrict, set
`CORS_ALLOWED_ORIGINS=https://example.com,https://other.example.com`.

## Configuration

| Env var                | Default        | Purpose                                     |
| ---------------------- | -------------- | ------------------------------------------- |
| `PORT`                 | `5002`         | TCP port to listen on                       |
| `API_BEARER_TOKEN`     | _unset_        | When set, required on every `/v1/*` request |
| `CORS_ALLOWED_ORIGINS` | _unset (open)_ | Comma-separated allowlist                   |

## Architecture

This package is a thin Express layer on top of
[`rules-visualizer-factgraph-core`](../factgraph-core), which owns the Fact
Graph parser, executor, and ruleset store. The same core also powers the
[visualizer](../factgraph-server) — both servers see identical execution
behavior because they're consuming the same engine.

```
  ┌──────────────────────────────┐    ┌──────────────────────────────┐
  │ rules-visualizer-factgraph   │    │ rules-visualizer-factgraph-  │
  │  (visualizer; web UI; AI)    │    │  api (this package)          │
  └──────────────────────────────┘    └──────────────────────────────┘
                  │                                  │
                  └──────────────┬───────────────────┘
                                 ▼
              ┌──────────────────────────────────────┐
              │ rules-visualizer-factgraph-core      │
              │  parser • executor • store           │
              │  (IRS Direct File factgraph wrapper) │
              └──────────────────────────────────────┘
```

## Roadmap

What's in this package today and what's planned. Stable items are documented
in the endpoint reference; planned items are open for partner-team input
before we land them.

| Status | Item                                                                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅     | Generic query endpoint with multi-target, execution-aware `missingInputs`, RFC 9457 errors                                                    |
| ✅     | Smart `missingInputs` — short-circuit operators prune resolved subtrees; unprovided collections propagate "still needed" through reverse-deps |
| ✅     | Opt-in `supportingFacts` (via `include`)                                                                                                      |
| ✅     | Opaque `metadata` passthrough                                                                                                                 |
| ✅     | Caller-provided member IDs surfaced as `{memberId, value}` arrays                                                                             |
| ✅     | Health probe                                                                                                                                  |
| ✅     | Optional bearer-token auth                                                                                                                    |
| ⏳     | Alternation in `missingInputs` (express "one-of" relationships when an `Any` could be satisfied by any of several inputs)                     |
| ⏳     | Structured explanation/trace on the query response (beyond flat supportingFacts list)                                                         |
| ⏳     | OpenAPI 3.1 spec served at `/v1/factgraph/openapi.yaml` + Swagger UI at `/v1/factgraph/docs`                                                  |
| ⏳     | Typed client packages (`@npm` consumer) generated from the OpenAPI                                                                            |
| ⏳     | SNAP-shaped convenience endpoints (`/evaluate/expedited-screening`, `/evaluate/determination`) layered over the generic query                 |
| ⏳     | Rate limiting                                                                                                                                 |

## License

MPL-2.0 — same as the parent repo.
