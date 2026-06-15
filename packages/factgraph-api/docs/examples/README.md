# Query examples — `snap-complete`

Ready-to-POST request bodies for the generic query endpoint:

```
POST /v1/factgraph/snap-complete/query
Content-Type: application/json
Authorization: Bearer <token>
```

These exercise the **advanced** Fact Graph API (the one that exposes the raw
graph by path), not the domain-oriented `/v1/eligibility` adapter. All three
are **generated from the live graph** (`npm run gen:examples`) and verified to
resolve to a complete determination — see the guard test in
`tests/query-examples.test.ts`, which re-runs each through the engine so a
rule change that breaks an example fails CI.

| File | Inputs | What it's for |
|---|---|---|
| [`snap-complete-all-inputs.query.json`](./snap-complete-all-inputs.query.json) | **159** — every writable | A complete reference: every input the graph has, populated. Realistic where it matters (age, citizenship, $1,200/mo wages, $800 rent, $500 checking), typed defaults elsewhere. |
| [`snap-complete-minimal.query.json`](./snap-complete-minimal.query.json) | **31** | The smallest set that yields the *same* determination — greedily reduced by dropping every field that doesn't change the outcome. Shows you don't need all 159. |
| [`snap-complete-multi-member.query.json`](./snap-complete-multi-member.query.json) | **358** — 3 members | A household with real cross-references: head + spouse (`spouseId` → `#1`), a child (`#2`), per-member incomes, and a caregiver relationship (head provides most of the child's care). |

All three currently resolve to:

- all-inputs / minimal — `eligibilityCategory: Ece`, `allotment: 200`, `proratedAllotment: 106`, `isExpedited: false`
- multi-member — `Ece`, `allotment: 271` (larger household), `isExpedited: false`

## Conventions worth knowing

- **`inputs` is one map keyed by fact path.** Scalars take a primitive;
  collection roots (`/members`, `/incomes`, `/expenses`, `/jobs`,
  `/resourceItems`, `/caregiverRelationships`) take an array of row objects,
  each row keyed by the wildcard path (`/members/*/age`) plus an optional
  `id` for response correlation.
- **Cross-references use the positional `#N` form**, not the row `id`:
  `/incomes/*/memberId: "#0"` points at the first `/members` row. The
  id-string form is not resolved by the engine.
- **`targets` is independent of inputs** — swap in any fact path(s) to read
  a different output (e.g. an intermediate gate). The examples target the
  four headline eligibility outputs.

## Quick run

```sh
curl -X POST \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d @snap-complete-minimal.query.json \
  https://rules-visualizer-factgraph-api-f0c14673cf3a.herokuapp.com/v1/factgraph/snap-complete/query
```

Regenerate after a graph change: `npm run gen:examples --workspace=rules-visualizer-factgraph-api`.
