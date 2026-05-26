# Changelog

Public-facing changes to the Fact Graph adapter API. Internal refactors
without surface impact aren't logged here; see git history for those.

## Unreleased

### Added

- Initial server scaffold (`packages/factgraph-api`).
- `GET /health` — liveness probe.
- `GET /v1/factgraph/rulesets` — list loaded rulesets.
- `GET /v1/factgraph/:rulesetId/schema` — node definitions, types, citations.
- `POST /v1/factgraph/:rulesetId/query` — generic query endpoint.
- **Multi-target queries.** Request body takes `targets` (array of fact
  paths). Response carries a `values` object keyed by target. Resolve
  multiple facts in one engine run.
- **`include` opt-in for response sections.** Pass `include:
["supportingFacts"]` to receive the dependency trace; default response
  is lean (just the requested values). Room for `"trace"`,
  `"counterfactuals"` later without changing the contract.
- **`metadata` passthrough.** Opaque correlation context echoed back
  unchanged. Never inspected, transformed, or logged. Matches the
  partner team's `AdapterRequest`/`AdapterResponse` contract.
- **Caller-provided member IDs.** Each entity row may carry an `id`
  field. Per-member response values come back as arrays of `{memberId,
value}` objects so callers can correlate output to specific rows
  without depending on order. Auto-generates `member-0`, `member-1`,
  ... when callers don't supply IDs.
- **Smart `missingInputs`.** The walker uses the partial execution
  result to prune subtrees that already resolved, so short-circuit
  operators (e.g. `Any` over `meetsCategoricalEligibility`) correctly
  shrink the asked set. Unprovided collections propagate "still needed"
  backward through the reverse-dependency graph so per-member writables
  surface even when the executor would otherwise default them to
  zero-row values. Missing inputs are unioned across all unresolved
  targets in multi-target requests, deduped by path.
- Optional bearer-token auth (env-gated).
- Permissive CORS by default; allowlist via `CORS_ALLOWED_ORIGINS`.
- All error responses follow RFC 9457 Problem Details.
- Request validation via Zod. Invalid request bodies return 400 with
  both a human-readable `detail` string and a machine-readable
  `errors[]` array identifying each failing field by path. The TypeScript
  request type is derived from the Zod schema so the runtime check and
  compile-time type are guaranteed to stay in sync.
- **OpenAPI 3.1 spec.** Generated from the same Zod schemas that
  validate runtime requests, plus hand-written component schemas for the
  response shapes. Served at:
    - `GET /v1/factgraph/openapi.json` — machine-readable spec, feed to
      `openapi-typescript`, `openapi-generator`, etc.
    - `GET /v1/factgraph/openapi.yaml` — same spec, YAML flavor.
    - `GET /v1/factgraph/docs` — interactive Swagger UI with an
      Authorize dialog where partners paste their bearer token for live
      "Try it" calls.
  All three are unauthenticated (mounted before the bearer-auth
  middleware) so partners can read the contract without credentials.
- **Public docs site on GitHub Pages.** Same OpenAPI spec, rendered by
  Redoc, deployed at
  [gary-community-ventures.github.io/rules-visualizer](https://gary-community-ventures.github.io/rules-visualizer/).
  Rebuilds automatically on every push to main that touches the API
  package (`.github/workflows/docs.yml`). Doesn't require the API to be
  up — handy for sharing contract links or browsing from a phone.

### Known limitations

- The smart walker doesn't yet model **alternation** — when an `Any`
  needs _one of_ N branches, both branches appear in `missingInputs`
  without indicating "either of these would do." Requires a richer
  response shape; tracked for future work.
- No structured explanation/trace yet (beyond the flat
  `supportingFacts` list).
- No published OpenAPI spec yet.
