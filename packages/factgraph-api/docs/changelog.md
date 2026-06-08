# Changelog

Public-facing changes to the Fact Graph adapter API. Internal refactors
without surface impact aren't logged here; see git history for those.

## Unreleased

### Added

- **Eligibility adapter endpoints** (`/v1/eligibility/evaluate/*`) —
  domain-oriented wrappers conforming to the partner team's
  [eligibility-adapter contract](https://github.com/codeforamerica/safety-net-blueprint/blob/main/packages/contracts/eligibility-adapter-openapi.yaml).
  The caller sends an ORCA-shaped request and receives a `ProgramDecision`;
  no Fact Graph paths are exposed. Path translation, the defaulting policy
  for fields the request doesn't carry, and the result mapping are all
  owned by the adapter.
  - `POST /v1/eligibility/evaluate/determination` — final SNAP
    determination (household program) against `snap-complete`. Per-applicant
    programs (medicaid/chip/tanf/ccdf) return `501` (not yet implemented).
  - `POST /v1/eligibility/evaluate/expedited-screening` — expedited SNAP
    screening (7 CFR §273.2(i)).
  - `POST /v1/eligibility/evaluate/medicaid-ex-parte` — reserved; returns
    `501` (depends on electronic data-exchange results not yet modeled).
  - Mounted at `/v1/eligibility` so a consumer can set its adapter base URL
    to `<host>/v1/eligibility` and reach the contract's bare `/evaluate/...`
    paths with no rewriting.
  - `ProgramDecision` carries `x-`-prefixed overlay extensions (sanctioned
    by the contract's `additionalProperties: true`): `x-allotment`,
    `x-proratedAllotment`, `x-expedited`, `x-translationNotes` (the
    defaulting assumptions the determination is conditional on),
    `x-missingInputs` (progressive-disclosure hook when `status: pending`),
    and `x-decidingPath` / `x-trace` when `include: ["trace"]` is set.
  - Documented in the OpenAPI spec under the **Eligibility Adapter** tag.

### Changed

- **Unified `inputs` shape.** The request body's `inputs` field now
  carries both scalar values and collection rows, keyed by fact path.
  Previously, scalars lived in `inputs` and collection rows lived in a
  separate top-level `entities` field. The two-field shape was
  asymmetric with the response (which already puts scalar values and
  per-member arrays both under `values` keyed by path); the new shape
  mirrors that exactly. The server splits scalars from collection rows
  at the API boundary based on the value's JSON shape (primitive vs
  array). No callers existed when this changed; the previous shape was
  never released.

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
- **Target explorer** at
  [gary-community-ventures.github.io/rules-visualizer/explore.html](https://gary-community-ventures.github.io/rules-visualizer/explore.html).
  Interactive browser for the API surface: pick a ruleset, pick a
  derived fact target, see the inputs required to determine it (with
  types, descriptions, and enum options), generate a starter request
  body. Drives off the live API; token is pasted by the user and stays
  in their browser. Complements Redoc (schema browse) and Swagger UI
  (endpoint try-it) with a target-oriented view.

- **Structured trace / explanation API.** Opt in via
  `include: ["trace"]` on a `/query` request. The response gains a
  `traces` map keyed by target path. Each entry is a recursive
  `TraceNode` tree showing how the target's value was derived: every
  All/Any walks its operands with deciding-branch semantics, every
  comparison surfaces the concrete operand values in its `reason`
  string, and policy citations from `references.json` flow through
  inline on facts that have them. V1 understands All, Any, Not, the six
  comparisons, Dependency references, and the common literal types
  (Int, Dollar, Boolean, etc.). Arithmetic and Switch operators are
  reported with the computed value but not yet broken down — query
  them directly to drill in.
- **`decisive: true` markers** on each `TraceNode.children` entry that
  contributed to its parent's value (All-false → only the first false
  child; All-true → every child; Any-true → only the first true child;
  Any-false → every child; single-operand structures → always).
  Lets UIs grey out non-contributing siblings without having to
  re-derive the operator semantics.
- **`decidingPaths`** at the response top level (sibling to `traces`).
  Keyed by target path; each entry is a compact ordered chain of
  path-bearing nodes from the target down to the deepest single-leaf
  cause. Powers headline rendering. Stops at branch points
  (All-true with multiple operands, Any-false where every operand
  failed) since beyond that the causation fans out — the full
  TraceNode tree remains the source of truth for branched chains.

### Internal

- Per-model lookup cache (`src/model-index.ts`). The path → node map,
  reverse-dependency index, and collection-root seed buckets are now
  computed once per parsed Model and stored in a WeakMap. Previous
  behavior rebuilt them on every `/query` request, which on big rulesets
  (tax-withholding-estimator has 948 nodes) meant multiple O(n) scans
  per multi-target request. No behavior change.

### Docs

- **Real-world walkthrough in `docs/examples-snap.md`** showing how a
  partner integrating against the `eligibility-adapter-openapi.yaml`
  contract maps a `HouseholdDeterminationRequest` onto our generic
  `/query` API and back to a `ProgramDecision`. Lead example is
  `snap-complete` (the team's full SNAP modelling); a simpler
  `snap-fy2026` walkthrough precedes it for onboarding. Concrete
  values for the snap-complete scenario are lifted from
  `data/factgraph/snap-complete/profiles.json` and verified end-to-end
  against prod.

### Known limitations

- The smart walker doesn't yet model **alternation** — when an `Any`
  needs _one of_ N branches, both branches appear in `missingInputs`
  without indicating "either of these would do." Requires a richer
  response shape; tracked for future work.
- No structured explanation/trace yet (beyond the flat
  `supportingFacts` list).
- No published OpenAPI spec yet.
