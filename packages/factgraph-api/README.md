# rules-visualizer-factgraph-api

Partner-facing HTTP adapter for [Fact Graph](https://github.com/IRS-Public/direct-file)
rulesets. Two API surfaces, each with its own OpenAPI contract:

- **Eligibility adapter (consumer-facing)** — domain-oriented determination
  endpoints (`/v1/eligibility/evaluate/*`) conforming to the
  [safety-net-blueprint eligibility-adapter contract](https://github.com/codeforamerica/safety-net-blueprint/blob/main/packages/contracts/eligibility-adapter-openapi.yaml).
  Send an ORCA-shaped household; get back a program decision. No Fact Graph
  internals anywhere in the contract. **Start here if you're integrating a
  caseworker tool or portal.**
- **Fact Graph query (advanced)** — a ruleset-agnostic API for evaluating any
  fact-graph target against partial input, with structured "missing inputs"
  feedback, traces, and policy citations. For tooling, exploration, and
  integrations that want direct access to the graph.

> **Prototype.** The API is under active development and not yet a production
> service. See `docs/changelog.md` for what's stable and what's still moving.

## Live URLs

|                                                            |                                                                                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **API base**                                               | `https://rules-visualizer-factgraph-api-f0c14673cf3a.herokuapp.com`                                                                        |
| **Eligibility contract — Swagger UI**                      | [`/v1/eligibility/docs`](https://rules-visualizer-factgraph-api-f0c14673cf3a.herokuapp.com/v1/eligibility/docs)                            |
| **Eligibility contract — OpenAPI 3.1 (for codegen/diff)**  | [`/v1/eligibility/openapi.yaml`](https://rules-visualizer-factgraph-api-f0c14673cf3a.herokuapp.com/v1/eligibility/openapi.yaml)            |
| **Advanced API — Swagger UI (paste-token-and-try)**        | [`/v1/factgraph/docs`](https://rules-visualizer-factgraph-api-f0c14673cf3a.herokuapp.com/v1/factgraph/docs)                                |
| **Static docs site (Redoc, doesn't need API up)**          | [gary-community-ventures.github.io/rules-visualizer](https://gary-community-ventures.github.io/rules-visualizer/)                          |
| **Target explorer (pick a fact, see its required inputs)** | [gary-community-ventures.github.io/rules-visualizer/explore.html](https://gary-community-ventures.github.io/rules-visualizer/explore.html) |
| **OpenAPI 3.1 spec (for codegen)**                         | [`/v1/factgraph/openapi.yaml`](https://rules-visualizer-factgraph-api-f0c14673cf3a.herokuapp.com/v1/factgraph/openapi.yaml)                |

Every `/v1/*` request needs `Authorization: Bearer <token>`. Get the token from
whoever set up your access. `/health`, the OpenAPI specs, and the docs pages
(`/v1/eligibility/openapi.{json,yaml}`, `/v1/eligibility/docs`,
`/v1/factgraph/openapi.{json,yaml}`, `/v1/factgraph/docs`) are unauthenticated.

```sh
# Sanity check
curl https://rules-visualizer-factgraph-api-f0c14673cf3a.herokuapp.com/health

# Real call
curl -X POST \
  -H 'Authorization: Bearer <your-token>' \
  -H 'Content-Type: application/json' \
  -d '{"targets":["/eligible"]}' \
  https://rules-visualizer-factgraph-api-f0c14673cf3a.herokuapp.com/v1/factgraph/snap-fy2026/query
```

## Quick start (local development)

If you need to run the API yourself — e.g. to iterate on rule changes against
a local dataset, or to develop against the API offline:

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
[`docs/bruno/`](docs/bruno/README.md) — environment-switchable between local
and prod. Install Bruno, open that folder, click Send.

## Endpoints

**Eligibility adapter (consumer contract):**

| Method | Path                                            | Purpose                                                          |
| ------ | ----------------------------------------------- | ---------------------------------------------------------------- |
| `POST` | `/v1/eligibility/evaluate/determination`        | Final determination — SNAP (household decision) or Medicaid (one decision per member) |
| `POST` | `/v1/eligibility/evaluate/expedited-screening`  | Expedited SNAP screening (7 CFR §273.2(i))                       |
| `POST` | `/v1/eligibility/evaluate/medicaid-ex-parte`    | Reserved — returns `501` (not yet modeled)                        |
| `GET`  | `/v1/eligibility/openapi.{json,yaml}` · `/docs` | Consumer contract + Swagger UI — public                           |

The committed contract snapshot lives at
`docs/eligibility-adapter-openapi.yaml`. Related reading:
`docs/contract-gap-analysis.md` (what the contract carries vs. what the
rulesets need) and `docs/request-field-proposal.md` (the proposed fields to
close that gap, and the defaulting policy).

**Fact Graph query (advanced):**

| Method | Path                              | Purpose                                      |
| ------ | --------------------------------- | -------------------------------------------- |
| `GET`  | `/health`                         | Liveness probe — `{ "status": "ok" }`        |
| `GET`  | `/v1/factgraph/rulesets`          | List loaded rulesets                         |
| `GET`  | `/v1/factgraph/:rulesetId/schema` | Node definitions, types, citations           |
| `POST` | `/v1/factgraph/:rulesetId/query`  | Evaluate a target node with partial inputs   |
| `GET`  | `/v1/factgraph/openapi.json`      | OpenAPI 3.1 spec (machine-readable) — public |
| `GET`  | `/v1/factgraph/openapi.yaml`      | OpenAPI 3.1 spec (YAML) — public             |
| `GET`  | `/v1/factgraph/docs`              | Interactive Swagger UI — public              |

The query endpoint is the advanced centerpiece — see `docs/concepts.md` for
the incompleteness model and `docs/examples-snap.md` for a worked SNAP
walkthrough.

The `/v1/factgraph/docs` URL is the easiest way to browse the API
interactively — paste your bearer token via the Authorize dialog and
every endpoint is "Try it"-able from the browser. For codegen, point
`openapi-typescript`, `openapi-generator`, or any OpenAPI-aware client
at `/v1/factgraph/openapi.yaml`.

There's also a public Redoc-rendered version at
[gary-community-ventures.github.io/rules-visualizer](https://gary-community-ventures.github.io/rules-visualizer/)
that doesn't require the API to be up — handy for browsing the contract
from a phone or sharing a link. The Pages site rebuilds automatically
on every push that touches the API package.

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
| ✅     | OpenAPI 3.1 spec at `/v1/factgraph/openapi.yaml` + Swagger UI at `/v1/factgraph/docs` (both unauthenticated)                                  |
| ✅     | Public docs site on GitHub Pages (Redoc renderer, auto-rebuilt on every push that touches the API)                                            |
| ✅     | Structured trace/explanation API via `include: ["trace"]` (recursive TraceNode tree with deciding-branch semantics + inline citations)        |
| ⏳     | Alternation in `missingInputs` (express "one-of" relationships when an `Any` could be satisfied by any of several inputs)                     |
| ⏳     | Trace v2: walk arithmetic + Switch ops, per-member traces for collection-scoped targets                                                       |
| ⏳     | Typed client packages (`@npm` consumer) generated from the OpenAPI                                                                            |
| ⏳     | SNAP-shaped convenience endpoints (`/evaluate/expedited-screening`, `/evaluate/determination`) layered over the generic query                 |
| ⏳     | Rate limiting                                                                                                                                 |

## License

MPL-2.0 — same as the parent repo.
