# Changelog

Public-facing changes to the Fact Graph adapter API. The API deploys
continuously rather than by tagged release, so entries are dated: a
section's changes are live on the production API as of its date. Internal
refactors without surface impact aren't logged here; see git history.

## 2026-07-08 — final means final: the decision finality gate

### Changed (behavior corrections a consumer may notice)

- **A decided status is now only returned when no unanswered question
  could change it.** The engine can technically compute a value past an
  unknown — it skips eligibility tiers whose condition it cannot evaluate
  and sums past incomplete collection rows — which previously produced
  committed determinations that would flip on the next answer: a medicaid
  `ineligible` that became `approved` once `pregnant` was asked, a SNAP
  `denied` (failed_net_income_test) that became `approved` once
  `receivesTanf` was asked, and an `approved` computed from an income row
  that carried only an id. All three now come back `pending`, with the
  blocking questions in `missingInputs` like any other gap. Fully-answered
  requests are unaffected — decided statuses still decide.
- **The medicaid ruleset no longer guesses.** Nine of its writables
  (pregnant, monthly hours worked, immigrant status, SSI, …) carried
  rules-level defaults that silently answered unasked questions —
  contradicting the no-guess contract. The defaults are removed, so thin
  medicaid requests that previously "decided" now come back `pending`
  asking those questions. Note the pregnancy count feeds the MAGI
  household size, so household FPL% (and therefore *every* member's
  determination) resolves only once each member's `pregnant` is answered.
- **Medicaid with no members is no longer a dead end.** An empty request
  returns one household-scoped `pending` determination whose first
  missing input is literally the members list, instead of
  `determinations: []` with no guidance.
- `status: "complete"` on `/query` now also requires resolved targets to
  be *supported*; the new `conditionalTargets` response field names
  targets that resolved only by stepping past unknowns.

### Changed (stricter validation — previously-accepted bad input now 400s)

- `asOf` must be a real `yyyy-mm-dd` date: nonexistent days
  (`2026-02-30`) are rejected instead of silently rolling over to March 2
  and skewing age derivation.
- Member `id`s must be non-empty strings, unique across the household
  *including* the positional `member-N` fallbacks (an explicit
  `"member-1"` can no longer collide with an id-less member's fallback).
  Row `id`s within a member's sub-collection must be unique, or instance
  addresses would be ambiguous.

### Added

- Sending `caregiverRelationships` rows to a program whose rules have no
  caregiver fields (medicaid) now earns a disclosure note instead of
  silence.
- The committed v2 spec snapshot is renamed
  `eligibility-adapter-v2-proposal-openapi.yaml` →
  **`eligibility-v2-openapi.yaml`** — it stopped being a proposal when it
  became the served 2.0.0 contract. The served URLs are unchanged.

## 2026-07-07 — missingInputs is now instanced (BREAKING)

The instanced shape introduced below as an opt-in experiment is now the
**only** `missingInputs` shape on the v2 surface (both determination
endpoints and the expedited screen). Spec version bumped to 2.0.0.

**What changed for a consumer.** Each entry now answers two questions:
`requestPath` says *which* field is unanswered (unchanged from before);
`at` says *where* — an ordered chain of `{in, id}` hops from the top of
your request down to the exact member or row that owes the value (empty =
household-level). Entries repeat per owing instance instead of being
deduped per field, and unanswered *collection questions* are their own
`kind: "unacknowledged"` entries instead of a pile of per-field gaps.

Before (one deduped entry per field, owner unknown):

```json
"missingInputs": [
  { "requestPath": "members[].dateOfBirth", "field": "dateOfBirth",
    "location": "members[]", "type": "Date", "label": "Date of birth" }
]
```

After (one entry per owing instance, addressed):

```json
"missingInputs": [
  { "kind": "field", "requestPath": "members[].dateOfBirth",
    "field": "dateOfBirth", "location": "members[]", "type": "Date",
    "label": "Date of birth",
    "at": [ { "in": "members", "id": "bob" } ], "memberId": "bob" },
  { "kind": "unacknowledged", "requestPath": "members[].income",
    "field": "income",
    "at": [ { "in": "members", "id": "bob" } ], "memberId": "bob",
    "hint": "Send income rows for this member, or [] if they have none." }
]
```

**Migration:**

- If you only read `requestPath`/`field`/`label`/`type`/`options`, field
  entries still carry all of those — but the same field can now appear
  once per owing row, so dedupe on `requestPath` if you want the old
  one-prompt-per-field view.
- Branch on `kind`: `unacknowledged` entries have no `location`/`type`/
  `label`; they carry a `hint` and mean "answer this collection with rows
  or []".
- For a per-person checklist, group entries on `at[0].id` (or the
  `memberId` echo). `missingInputsByMember` is now **deprecated** — still
  attached so existing code keeps working, but it is derivable from the
  entries and will be removed once integrators have migrated.
- The evaluation-window request flag `missingInputsFormat` is deprecated
  and ignored; sending `"fields"` earns a migration note in `notes`.

## 2026-07-07 — instanced missing-inputs (experimental, opt-in) + medicaid pending guard

### Added (opt-in — no default-behavior change)

- **`missingInputsFormat: "instanced"`** on the v2 determination requests
  switches `missingInputs` to the shape under evaluation to replace the
  current one: **one entry per concrete instance**, each carrying two
  orthogonal addresses — `requestPath` (the schema address: which question)
  and `at` (the instance address: ordered `{in, id}` hops from the request
  root down to the row that owes the value; empty = household-level).
  Household = 0 hops, member = 1, sub-collection row = 2; depth N and
  member-less collections (caregiverRelationships) address uniformly.
  A second entry kind, **`unacknowledged`**, makes the rows-or-`[]`
  acknowledgment rule visible instead of doc-only ("does this member have
  any income?"), and recurses to the root: an empty request's first missing
  input is literally `{field: "members", at: []}`. `memberId` echoes
  `at[0].id` (groupBy convenience) and `missingInputsByMember` stays
  attached unchanged in both formats during the evaluation window.
  Feedback welcome — this may become the default in a future rev, with
  notice. The demo page has an "instanced missingInputs" toggle.
- The advanced `/query` endpoint exposes the raw layer as
  `include: ["missingInputInstances"]` (engine paths + hop chains).

### Fixed (behavior corrections observable on the wire)

- **Medicaid no longer returns a committed `ineligible` for members whose
  age never resolved.** The category Switch's catch-all yields `Ineligible`
  when the age-gated category checks are unknown rather than false — a
  member with no data came back confidently ineligible
  (`not_in_eligible_category`). Such members are now `pending` with their
  missing inputs listed, mirroring the SNAP pending guard. The artifact
  `medicaidCategory`/`chpEligible` values are suppressed on pending.
- **`status: "complete"` now means every requested value resolved for
  every row.** A per-member target with unresolved slots (`[36, null]`)
  previously counted as resolved, so `/query` could report `complete`
  while a member's value was null and list no missing inputs for it.

## 2026-07-06 — trace correctness, error handling, contract cleanup

### Changed (breaking — flagged for consumers)

- **v2 `medicaidCategory` values are now snake_case** (`adult`, `infant`,
  `older_child`, `ssi_recipient`, `ineligible`, …), matching the stated
  wire convention and the request-side enum casing. Previously leaked the
  engine's PascalCase (`Adult`, `OlderChild`). Migration: lowercase +
  underscore your comparisons. v1's `x-medicaidCategory` is unchanged
  (frozen contract, documented PascalCase).
- **v2 duplicate member `id`s are rejected with a 400.** Previously two
  members sharing an id were silently merged (their per-member missing
  inputs collapsed under one key; reference fields resolved to the later
  member). If you send ids, make them unique.
- **v2 malformed sub-collection rows are rejected with a 400.** A `null`
  or non-object entry in `members[].income[]` (and expenses/jobs/assets)
  previously crashed with an HTML 500; now it's a Problem Details 400
  naming the offending row.
- **v2 `status` enum no longer includes `not_supported`** — it was
  documented but unreachable (no route ever produced it). Unknown
  programs now get a Problem Details 404 naming the available operations
  (previously an HTML "Cannot POST" page).
- **`/v1/eligibility` "ruleset unavailable" is now 503** (was 500),
  matching v2. Callers treating any 5xx as retryable are unaffected.

### Fixed (behavior corrections observable on the wire)

- **Traces: comparison nodes now report their own result.** Inline
  comparisons inside `Any`/`All`/`When` previously echoed the enclosing
  fact's value — a trace could claim `99999 ≤ 1695.2 — held.` when the
  parent `Any` was true via a different branch, and the decisive flag
  could land on the wrong operand. Comparisons now compute from their own
  operand values (and stay `pending` when an operand is unresolved), so
  decisive-branch selection and `x-explanation`/`explanation` derivation
  are grounded in the actual math.
- **Traces: relative dependency paths resolve.** `../age`-style and
  bare-sibling dependency references (most member-level logic) previously
  dead-ended as "Unresolved dependency"; they now resolve like the engine
  resolves them. Paths that traverse collection references
  (`relatedTo/...`) are reported as such rather than as unresolved.
- **Traces: collection-scoped targets are traced per row.** A per-member
  target now returns a `PerMember` root with one fully-walked sub-trace
  per row, tagged `memberId` (previously the walker read the positional
  array as an unevaluated scalar and reported "No operand has held yet"
  on resolved facts). `decidingPaths` steps inside a row's sub-trace
  carry the `memberId`.
- **v1: `household.isMigrantOrSeasonalFarmWorker` is now applied** to the
  member rows (it feeds the destitute-household expedited screen).
  Previously accepted and silently ignored.
- **v1: a `household.size` that disagrees with the member roster is now
  disclosed** in `x-translationNotes` (size is derived from the roster
  and cannot be honored directly). Previously silently ignored.
- **v1: expedited screening now carries `x-translationNotes`** — the
  household-only-shape disclosure was generated but dropped by the route.

### Added

- **RFC 9457 everywhere.** A global error boundary replaces Express's
  default HTML error page: malformed JSON → 400 Problem Details, body
  over 10 MB → 413, unexpected faults → 500 with a generic detail (no
  stack traces or filesystem paths leak to clients; details go to server
  logs). The v2 routes' engine calls are also guarded (previously an
  engine throw returned HTML with a stack).
- **Empty `API_BEARER_TOKEN` fails closed.** A set-but-empty token env
  var (e.g. a bare `API_BEARER_TOKEN=` line in `.env`) now yields 503
  "Authentication misconfigured" on protected routes instead of silently
  running the server open.
- **v2 partial sub-collection acknowledgment is disclosed.** When some
  members carry `income: [...]` but another member omits the key
  entirely, the withheld rows are now reported in `notes` (previously
  the provided rows were silently not evaluated). Reminder: every member
  must acknowledge each sub-collection, `[]` meaning "none".
- **Specs document the full failure surface**: 413/500/503 responses,
  the `errors[]` field on validation 400s, and the
  `missingInputsByMember` response field on `/query` (already live, was
  undocumented). The v1 spec's request `metadata` is now correctly
  optional (the server never required it). The v2 medicaid example now
  uses medicaid-catalog field names (`immigrantStatus`, …) instead of
  SNAP ones. `/v2/eligibility/medicaid/ex-parte` (501 stub) is now in
  the spec. v2 `Member.id` is documented as optional-but-recommended
  with the `member-N` fallback described, matching the implementation.
- **v2 missing-inputs attachment is now uniform across programs**:
  medicaid determinations attach `missingInputs` whenever any needed
  inputs remain (as SNAP already did), not only on `pending`.

### Docs

- `docs/input-dictionary.md` is demoted to a **field-grouping proposal**
  with a banner: its field names follow the earlier proposal routing
  table, not the implemented v2 vocabulary — the
  [engine-input catalog](https://gary-community-ventures.github.io/rules-visualizer/engine-inputs.html)
  is the authoritative field list for the live endpoints.
- The stale "Known limitations" tail (claiming no traces and no OpenAPI
  spec existed) is corrected.

## 2026-06 and earlier — initial adapter build-out

### Added

- **Contract-exact conformance** (verified against the published adapter
  contract's schemas; see the new [`docs/v1-conformance.md`](./v1-conformance.md)
  matrix):
  - Member `id` and `dateOfBirth` are now optional (the published member has
    no required fields and no id) — absent ids fall back to positional
    `member-N` handles; absent birth dates default age with disclosure.
  - `household.housingCosts` / `utilityCosts` are now applied as monthly
    shelter/utility expenses when no member-level expense covers them
    (previously accepted but silently ignored — wrong shelter math for
    conformant minimal callers).
  - `member.employment[].hoursPerWeek` is now consumed for SNAP work
    requirements; `healthCoverage` accepted for compatibility.
  - Household-only expedited screening (the contract-exact shape) is now
    accepted: since the contract's household carries no income or
    liquid-resource fields, the response is a conservative
    `expedited: false` plus `x-missingInformation` naming what's needed.
  - The contract's per-applicant `IndividualDeterminationRequest` is now
    accepted for medicaid, wrapped as a sole-applicant household with the
    assumption disclosed in `x-translationNotes`.

- **v2 engine-shaped eligibility surface** at `/v2/eligibility` — the rules
  engine is the source of truth; send friendly named fields, get back
  first-class outcome fields and per-member `missingInputs`. Spec at
  `GET /v2/eligibility/openapi.{json,yaml}` + Swagger UI at
  `/v2/eligibility/docs` (committed snapshot:
  `docs/eligibility-v2-openapi.yaml`):
  - `POST /v2/eligibility/snap/determination` — SNAP household determination,
    no-guess. Returns a single household-scoped determination; expedited
    screening folds in as `isExpedited`.
  - `POST /v2/eligibility/medicaid/determination` — Medicaid determination,
    no-guess, per member. Returns one member-scoped determination per
    household member, each with `missingInputs` attributed to that specific
    member.
  - `POST /v2/eligibility/snap/expedited-screening` — purpose-built
    expedited screening (7 CFR §273.2(i)). Returns `{ isExpedited: boolean |
    null }` — `null` when inputs are insufficient; `missingInputs` lists
    exactly what's needed to resolve the screen.
  - `/medicaid/ex-parte` returns `501` pointing at the frozen v1 surface.

- **Eligibility adapter endpoints** (`/v1/eligibility/evaluate/*`) —
  domain-oriented wrappers conforming to the partner team's
  [eligibility-adapter contract](https://github.com/codeforamerica/safety-net-blueprint/blob/main/packages/contracts/eligibility-adapter-openapi.yaml).
  The caller sends an ORCA-shaped request and receives a `ProgramDecision`;
  no Fact Graph paths are exposed. Path translation, the defaulting policy
  for fields the request doesn't carry, and the result mapping are all
  owned by the adapter.
  - `POST /v1/eligibility/evaluate/determination` — final determination.
    **SNAP** (household program) → one `ProgramDecision` against
    `snap-complete`. **Medicaid** → a `MedicaidDeterminationResponse` with
    one decision per member (household-in / per-member-out, since MAGI
    eligibility depends on the whole household). `chip`/`tanf`/`ccdf` → `501`.
  - `POST /v1/eligibility/evaluate/expedited-screening` — expedited SNAP
    screening (7 CFR §273.2(i)).
  - `POST /v1/eligibility/evaluate/medicaid-ex-parte` — reserved; returns
    `501` (depends on electronic data-exchange results not yet modeled).
  - Mounted at `/v1/eligibility` so a consumer can set its adapter base URL
    to `<host>/v1/eligibility` and reach the contract's bare `/evaluate/...`
    paths with no rewriting.
  - Responses are **path-free** — no Fact Graph paths, targets, or traces.
    `x-`-prefixed overlays: `x-allotment`, `x-proratedAllotment`,
    `x-expedited`, `x-translationNotes` (defaulting assumptions the
    determination is conditional on), `x-missingInformation` (still-needed
    fields by name, when `status: pending`), and `x-explanation` (a
    domain-summarized "why" on denials). `denialReasonCode` is snake_case;
    `denied` (failed a test, appealable) is distinguished from `ineligible`
    (categorical bar).
- **Separate consumer-facing OpenAPI document** at
  `GET /v1/eligibility/openapi.{json,yaml}` and Swagger UI at
  `/v1/eligibility/docs` (committed snapshot:
  `docs/eligibility-adapter-openapi.yaml`). Contains only the
  `/v1/eligibility/evaluate/*` endpoints, ORCA-shaped with documented enums
  and a representative example, and no Fact Graph paths. The advanced
  Fact Graph query/discovery API stays in the separate `docs/openapi.yaml`.

### Changed

- **SNAP determination evaluates as of the request date.** The application
  timing facts (`filing date`, `benefit month`, `certification period start`,
  `issuance cycle date`) were previously fixed to a January 2025 baseline;
  they are now derived from the evaluation date — calling the endpoint means
  "evaluate this application as of now," so first-month proration reflects
  the actual filing day. A future `applicationContext` request block will
  make these caller-settable (see `docs/request-field-proposal.md` §5).
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
  response shape; tracked for future work. Corollary: `missingInputs`
  is a *may-be-needed* set, not a guaranteed-minimal one.
- Traces don't descend arithmetic/collection operators (Multiply,
  Filter, Count, …) or `Switch` `Then` values — those nodes report
  their computed value but not their sub-expressions. Query the
  intermediate facts directly to drill in.
