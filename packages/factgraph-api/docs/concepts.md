# Concepts

This API serves [Fact Graph](https://github.com/IRS-Public/direct-file)
rulesets — a format from IRS Direct File for expressing rules as a directed
graph of facts. Each fact is either a writable input (something the caller
provides) or a derived expression computed from other facts. Conceptually:

- **Inputs** are leaves: dollar amounts, booleans, dates, enums.
- **Outputs** are roots: typed values computed by walking the graph.
- **Intermediate facts** are everywhere in between.

A "ruleset" is a directory of XML modules that together define one such
graph (e.g. `snap-fy2026/`). Multiple rulesets live in this repo; pick one
by `rulesetId` in the URL.

## The query model

The core operation is: **given some inputs, what are the values of these
target facts?**

```json
POST /v1/factgraph/snap-fy2026/query
{
  "targets": ["/eligible", "/snap"],
  "inputs":  { "/grossEarnedIncome": 1500, ... },
  "entities": {
    "/members": [
      { "id": "applicant", "/members/*/age": 30, ... },
      { "id": "spouse",    "/members/*/age": 32, ... }
    ]
  },
  "include":  ["supportingFacts"],
  "metadata": { "applicationId": "abc-123" }
}
```

| Field      | Required | Purpose                                                                                                               |
| ---------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `targets`  | yes      | Array of fact paths to evaluate. Single-value queries use a one-element array.                                        |
| `inputs`   | no       | Scalar writable inputs, keyed by fact path.                                                                           |
| `entities` | no       | Per-collection rows. Each row may carry a caller-provided `id`.                                                       |
| `include`  | no       | Opt-in response sections. Today: `"supportingFacts"`. Future: `"trace"`, `"counterfactuals"`. Unknown values ignored. |
| `metadata` | no       | Opaque correlation context. Echoed back unchanged; never inspected or logged.                                         |

The response shape is the same regardless of whether the engine fully
resolves the targets or not:

```json
{
  "status": "complete" | "incomplete",
  "rulesetVersion": "snap-fy2026",
  "metadata": { ...echoed... },          // omitted if request didn't send one
  "values": {
    "/eligible": true,
    "/snap": 298
  },
  "supportingFacts": [...],              // present only if requested via include
  "missingInputs": [...]                 // present only when status === "incomplete"
}
```

### `status === "complete"`

Every requested target resolved. `values[path]` is the computed value
for each one.

### `status === "incomplete"`

At least one target couldn't be computed. Unresolved targets appear as
`null` in `values`; resolved targets carry their value normally.
`missingInputs` contains the union of writables still needed across all
unresolved targets (deduped by path).

## Per-member values

Collection-scoped facts (paths whose middle segment is the wildcard,
e.g. `/members/.../isEligibleMember`) are returned as arrays of
`{memberId, value}` objects:

```json
"values": {
  "/members/*/isEligibleMember": [
    { "memberId": "applicant", "value": true },
    { "memberId": "spouse",    "value": false }
  ]
}
```

`memberId` echoes whatever the caller supplied on the corresponding
entity row's `id` field. If the caller didn't supply one, the server
auto-generates `member-0`, `member-1`, etc. Either way, every entry is
addressable — there's no positional matching required on the client.

The same shape appears in `supportingFacts` for any per-member fact in
the trace.

## Progressive disclosure

The `missingInputs` list lets a partner UI drive its intake form
**dynamically**: render an empty form, post what you have, render only
the fields the engine still asks for. As the user fills in fields and
the UI re-POSTs, `missingInputs` shrinks.

The walker is **execution-aware**: before deciding what's still needed,
the server runs the engine against whatever inputs were provided and
prunes any fact-graph subtree whose root already resolved.

- Provide `meetsCategoricalEligibility: true` → the engine short-circuits
  the eligibility `Any(...)` and resolves `/eligible` without needing
  the income/asset subtree. `missingInputs` shrinks accordingly.
- Provide all scalar inputs but no member rows → the per-member subtree
  surfaces as missing because there's no member data yet.
- Provide nothing → the full intake-form shape comes back as
  `missingInputs`.

### Known limitation: alternation

When a derived fact is `Any(A, B)` and _either_ A or B would resolve it,
the response currently lists both branches' inputs as missing without
indicating "you only need one of these." That's correct in the sense
that providing either would advance the form, but the API doesn't yet
express the alternation relationship. Tracked for future work.

## Opting into supporting facts

By default the response carries the values of the requested targets
only. Pass `"include": ["supportingFacts"]` to additionally receive
every fact in the targets' dependency trees that resolved, along with
its display name and CCR citations (where mapped). Useful for "why"
explanations and audit trails; skip it when you only need the answer.

The supporting-facts list is capped at 200 entries per response so it
doesn't return the entire graph for shallow targets.

## Opting into the structured trace

Pass `"include": ["trace"]` to additionally receive a `traces` map
keyed by target path. Each entry is a recursive `TraceNode` tree
walking how the target's value was derived from its inputs. Unlike
`supportingFacts` (a flat list), `traces` preserves the operator
structure of the rules:

- `All` that's false → `reason` calls out the first-false child by
  display name; all branches appear in `children` so the caller can
  see both the deciding gate and the alternatives that did hold.
- `Any` that's true → `reason` calls out the satisfying branch.
- Comparisons (`LessThanOrEqual`, `GreaterThan`, etc.) → `reason`
  includes the concrete operand values: *"Gross monthly income (3500)
  ≤ Gross income limit (1695.2) — did not hold."*
- Dependency references recursively walk into the target fact.
- Policy citations from `references.json` flow through on the
  corresponding `TraceNode`s.

V1 walks booleans, comparisons, dependency references, and the common
literal types (Int, Dollar, Boolean, etc.). Arithmetic operators
(`Multiply`, `Add`, `Subtract`, ...) and `Switch` report the computed
value but don't recurse — query those facts directly for their
breakdown. Per-member trace for collection-scoped targets is planned;
ask for a scalar parent instead today.

Both `supportingFacts` and `trace` can be requested at once.

## Metadata passthrough

Anything you put in `metadata` comes back unchanged in the response.
The server treats it as opaque — never inspects, transforms, logs, or
persists it. Use it for client-side correlation: application IDs, trace
IDs, request fingerprints. Matches the pattern documented in the
partner team's `AdapterRequest`/`AdapterResponse` schemas.

## Versioning

Each response carries `rulesetVersion` identifying the exact ruleset
evaluated (e.g. `"snap-fy2026"`). When a new fiscal year's rules ship,
the ID changes (`"snap-fy2027"`); partners can pin during testing or
let the server use its current default.

Within a single ruleset, top-level outputs (`/eligible`, `/snap`) are
intended to be stable. Internal helpers may rename across versions —
depend on the documented public outputs, not every internal path.

## Citations

Many facts carry policy citations resolved from each ruleset's
`references.json` — CCR sections, CFR clauses, statutes. These appear
on the schema endpoint per node and will appear inline on
supporting-facts trace items as the structured-trace work lands.

## What's NOT in this API

A few things explicitly out of scope:

- **Stateful storage.** Every request is independent. No application
  records, no caseworker queue, no audit log of historical
  determinations. Partner systems own state.
- **PII processing guarantees.** This is a prototype; data is not
  logged but also not audited for compliance. Don't send live applicant
  data until we've had that conversation.
- **Workflow.** "Should this be deferred to a caseworker?" is a partner
  decision based on the response, not something the API decides.
