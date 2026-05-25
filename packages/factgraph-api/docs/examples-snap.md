# Worked example: SNAP eligibility

A walk-through of the query API using the `snap-fy2026` ruleset. SNAP
(Supplemental Nutrition Assistance Program) is the most-developed
ruleset in the repo and serves as a concrete reference for what an
integration looks like in practice.

All examples assume the API is running at `http://localhost:5002` with
auth disabled. In a deployed environment, add
`-H 'Authorization: Bearer <token>'` to every call.

## 1. Discover the ruleset

```sh
curl http://localhost:5002/v1/factgraph/rulesets
```

```json
{
  "rulesets": [
    { "id": "snap-fy2025", "name": "Snap Fy2025", "format": "factGraph" },
    { "id": "snap-fy2026", "name": "Snap Fy2026", "format": "factGraph" },
    { "id": "medicaid",    "name": "Medicaid",    "format": "factGraph" },
    ...
  ]
}
```

## 2. Discover the inputs

Issue a query with no inputs and read `missingInputs`:

```sh
curl -X POST http://localhost:5002/v1/factgraph/snap-fy2026/query \
  -H 'Content-Type: application/json' \
  -d '{ "targets": ["/eligible"] }'
```

```json
{
  "status": "incomplete",
  "rulesetVersion": "snap-fy2026",
  "values": { "/eligible": null },
  "missingInputs": [
    { "path": "/grossEarnedIncome", "name": "Gross earned income", "dataType": "Dollar", "description": "Monthly earned income before taxes (wages, salary, self-employment)" },
    { "path": "/members/*/age",     "name": "Age", "dataType": "Int" },
    { "path": "/members/*/isDisabled", "name": "Is disabled", "dataType": "Boolean" },
    ...
  ]
}
```

This is the form your UI should render — exactly the fields that go into
the eligibility determination.

## 3. Run a determination

A single-person household, no income, no assets. Note the `id` on the
member row — it lets the response correlate per-member values back to
the right row.

```sh
curl -X POST http://localhost:5002/v1/factgraph/snap-fy2026/query \
  -H 'Content-Type: application/json' \
  -d '{
    "targets": ["/snap"],
    "inputs": {
      "/grossEarnedIncome": 0,
      "/unearnedIncome": 0,
      "/dependentCareExpenses": 0,
      "/rent": 0,
      "/realEstateTaxes": 0,
      "/homeownersAssociationFees": 0,
      "/mortgagePayments": 0,
      "/homeownersInsurance": 0,
      "/meetsCategoricalEligibility": false,
      "/childSupportPaid": 0,
      "/isHomeless": false
    },
    "entities": {
      "/members": [{
        "id": "applicant",
        "/members/*/isElderly": false,
        "/members/*/isDisabled": false,
        "/members/*/medicalExpenses": 0,
        "/members/*/age": 30,
        "/members/*/isHigherEdStudent": false,
        "/members/*/weeklyWorkHours": 40,
        "/members/*/isWorkStudy": false,
        "/members/*/isParent": false,
        "/members/*/isFullTimeCollegeStudent": false,
        "/members/*/receivesTanf": false,
        "/members/*/isImmigrationEligible": true,
        "/members/*/isPregnant": false,
        "/members/*/isIncapableOfSelfCare": false,
        "/members/*/abawdCountableMonthsUsed": 0,
        "/members/*/cashOnHand": 0,
        "/members/*/bankAccountAssets": 0,
        "/members/*/stockAssets": 0,
        "/members/*/bondAssets": 0
      }]
    }
  }'
```

```json
{
  "status": "complete",
  "rulesetVersion": "snap-fy2026",
  "values": { "/snap": 298 }
}
```

Single person with zero income gets the FY2026 maximum allotment of $298.

## 4. Ask for multiple values, supporting facts, and pass metadata

The same call can target several facts at once, request the supporting
facts trace, and pass opaque metadata for client-side correlation:

```sh
curl -X POST http://localhost:5002/v1/factgraph/snap-fy2026/query \
  -H 'Content-Type: application/json' \
  -d '{
    "targets": ["/eligible", "/snap", "/grossIncomeLimit"],
    "inputs": { ... same as above ... },
    "entities": { ... same as above ... },
    "include": ["supportingFacts"],
    "metadata": {
      "applicationId": "abc-123",
      "traceId": "xyz"
    }
  }'
```

```json
{
  "status": "complete",
  "rulesetVersion": "snap-fy2026",
  "metadata": { "applicationId": "abc-123", "traceId": "xyz" },
  "values": {
    "/eligible": true,
    "/snap": 298,
    "/grossIncomeLimit": 1695.2
  },
  "supportingFacts": [
    { "path": "/eligible", "name": "Eligible for SNAP", "value": true },
    { "path": "/hasEligiblePerson", "name": "Has eligible person", "value": true },
    { "path": "/householdSize", "name": "Household size", "value": 1 },
    {
      "path": "/members/*/isEligibleMember",
      "name": "Is eligible member",
      "value": [
        { "memberId": "applicant", "value": true }
      ]
    },
    ...
  ]
}
```

Three things to notice:

- `values` is keyed by target path. Three targets, three entries.
- `metadata` is echoed back unchanged.
- Per-member facts in `supportingFacts` are arrays of `{memberId, value}`.
  The `memberId` matches the `id` you provided on the member row.

## 5. Query an intermediate gate directly

You don't have to ask for the final answer. Ask for any node:

```sh
curl -X POST http://localhost:5002/v1/factgraph/snap-fy2026/query \
  -H 'Content-Type: application/json' \
  -d '{
    "targets": ["/grossIncomeLimit"],
    "entities": {
      "/members": [{
        "id": "applicant",
        "/members/*/age": 30,
        "/members/*/isImmigrationEligible": true,
        "/members/*/isElderly": false,
        "/members/*/isDisabled": false,
        "/members/*/isHigherEdStudent": false
      }]
    }
  }'
```

Returns the computed gross income limit for the configured household
size. Useful for diagnostic UIs — "what threshold am I being compared
against?" — without having to feed in the full household.

## 6. Multi-member: per-member output shape

Send two members and ask for a per-member fact directly:

```sh
curl -X POST http://localhost:5002/v1/factgraph/snap-fy2026/query \
  -H 'Content-Type: application/json' \
  -d '{
    "targets": ["/members/*/isEligibleMember"],
    "inputs": { ...all scalars zeroed... },
    "entities": {
      "/members": [
        { "id": "applicant", ...full set of member fields... },
        { "id": "spouse",    ...full set of member fields... }
      ]
    }
  }'
```

```json
{
  "status": "complete",
  "rulesetVersion": "snap-fy2026",
  "values": {
    "/members/*/isEligibleMember": [
      { "memberId": "applicant", "value": true },
      { "memberId": "spouse", "value": true }
    ]
  }
}
```

`memberId` correlates each value back to the input row you provided.

## Notes for the partner integration

- **Frequency normalization.** This API expects monthly dollar values.
  If your domain captures `frequency: weekly|hourly|...`, normalize on
  your side before calling.
- **Member arrays.** Collection-scoped inputs (anything with `*` in the
  path) go in `entities`, not `inputs`. The key is the collection root
  (`/members`); the value is an array of row objects where each row
  uses the full wildcard path as the field key. Each row may carry an
  `id` for correlation.
- **The "complete" status doesn't mean "eligible".** It means the
  engine had enough information to answer. The answer may be `false`
  (ineligible) or a $0 benefit. Read `values[path]`, not just `status`.
- **`null` in `values` means "we couldn't compute that target."**
  Other targets in the same response may still have resolved. Always
  check the value before consuming.
