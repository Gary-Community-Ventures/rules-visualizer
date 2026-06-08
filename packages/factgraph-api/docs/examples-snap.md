# Worked example: SNAP eligibility

This doc walks through how to call this API from a system that already
holds eligibility data in the
[`HouseholdDeterminationRequest`](https://github.com/codeforamerica/safety-net-blueprint/blob/main/packages/contracts/eligibility-adapter-openapi.yaml)
shape — translating your domain data into a query, running it, and
mapping the response back to a `ProgramDecision`.

Two parts:

1. **Quick walkthrough** using the smaller `snap-fy2026` ruleset — a
   crisp introduction to the request/response shape.
2. **Real-world walkthrough** using `snap-complete`, showing the
   adapter-contract-to-query translation end to end.

## Which SNAP ruleset to use

This API serves two SNAP rulesets with different shapes and purposes.

| Ruleset | Inputs | Source | When to use |
| --- | --- | --- | --- |
| **`snap-complete`** | ~17 scalar + ~142 per-member writables across five collections (`/members`, `/incomes`, `/expenses`, `/jobs`, `/resourceItems`) | Full modelling of the Colorado SNAP rule (10 CCR 2506-1) | Production-grade determinations — eligibility category, expedited screening, allotment + prorated allotment, denial reasons |
| **`snap-fy2026`** | ~11 scalar + ~18 per-member writables, single `/members` collection | A subset modelled after PolicyEngine-US's `is_snap_eligible` covering the most common rules | Demos, quick experiments, prototypes where the full input surface would be a distraction |

The main walkthrough below uses `snap-complete` because that's the
right target for a real integration. The quick walkthrough above it
uses `snap-fy2026` because it's smaller and easier to read on a first
pass.

Throughout this doc the base URL is the live API:

```
https://rules-visualizer-factgraph-api-f0c14673cf3a.herokuapp.com
```

Every `/v1/*` example needs an `Authorization: Bearer <token>` header.
Examples omit it for brevity; add yours.

---

# Quick walkthrough (snap-fy2026)

## 1. Discover the ruleset

```sh
curl https://rules-visualizer-factgraph-api-f0c14673cf3a.herokuapp.com/v1/factgraph/rulesets
```

```json
{
  "rulesets": [
    { "id": "snap-complete", "name": "Snap Complete", "format": "factGraph" },
    { "id": "snap-fy2026",   "name": "Snap Fy2026",   "format": "factGraph" },
    { "id": "medicaid",      "name": "Medicaid",      "format": "factGraph" },
    ...
  ]
}
```

## 2. Discover the inputs

Issue a query with no inputs and read `missingInputs`:

```sh
curl -X POST .../v1/factgraph/snap-fy2026/query \
  -H 'Content-Type: application/json' \
  -d '{ "targets": ["/eligible"] }'
```

```json
{
  "status": "incomplete",
  "rulesetVersion": "snap-fy2026",
  "values": { "/eligible": null },
  "missingInputs": [
    { "path": "/grossEarnedIncome", "name": "Gross earned income", "dataType": "Dollar" },
    { "path": "/members/*/age",     "name": "Age",                  "dataType": "Int" },
    { "path": "/members/*/isDisabled", "name": "Is disabled",       "dataType": "Boolean" },
    ...
  ]
}
```

That's the form your UI should render — exactly the fields needed.

## 3. Run a determination

```sh
curl -X POST .../v1/factgraph/snap-fy2026/query \
  -H 'Content-Type: application/json' \
  -d '{
    "targets": ["/eligible", "/snap"],
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
      "/isHomeless": false,
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
  "values": { "/eligible": true, "/snap": 298 }
}
```

That's the whole request/response loop. Single person, zero income →
eligible, $298/month (FY2026 max allotment for one).

---

# Real-world walkthrough (snap-complete)

This is what an integration call looks like end to end. Start with a
`HouseholdDeterminationRequest` matching your adapter contract,
translate it into a call against `/v1/factgraph/snap-complete/query`,
and translate the response back into a `ProgramDecision`.

## What you have to start with

Your adapter receives a request like:

```json
{
  "metadata": { "applicationId": "case-1234", "traceId": "req-abc" },
  "program": "snap",
  "household": { "size": 1 },
  "members": [
    {
      "id": "head",
      "dateOfBirth": "1990-03-15",
      "citizenshipStatus": "us_citizen",
      "relationshipToHead": "head_of_household",
      "isDisabled": false,
      "programs": ["snap"],
      "income": [
        { "type": "employed", "amount": 1200, "frequency": "monthly", "incomeBasis": "gross" }
      ],
      "expenses": [
        { "category": "housing", "amount": 800, "frequency": "monthly" }
      ],
      "assets": [
        { "type": "liquid", "value": 500, "description": "checking account" }
      ]
    }
  ],
  "verificationSummary": []
}
```

A single 35-year-old working applicant: $1,200/month in wages,
$800/month rent, $500 in a checking account. This is what shows up at
intake after a case is filed and some basic verification has been
done.

## What you want to produce

A `ProgramDecision`:

```json
{
  "metadata": { ... echoed ... },
  "program": "snap",
  "status": "approved" | "denied" | "ineligible" | "pending",
  "path": "auto",
  "denialReasonCode": "..."   // present when status != approved
}
```

## Step 1 — translate the request

Inputs of every kind live in the single `inputs` map, keyed by fact
path or collection root. Scalar facts take a primitive value;
collection roots (`/members`, `/incomes`, `/expenses`, `/jobs`,
`/resourceItems`) take an array of row objects. The translation has
three moving parts: scalar context, the `/members` collection, and the
per-member arrays (income / expenses / assets) which fan out into
**separate** top-level collections in the query body.

```jsonc
{
  // The four outputs you'll read to build a ProgramDecision.
  "targets": [
    "/isExpedited",         // expedited-screening result
    "/eligibilityCategory", // Bce | Ece | Se | Ineligible
    "/allotment",           // full month allotment
    "/proratedAllotment"    // partial first-month allotment
  ],

  // Echoed unchanged in the response — use for correlation.
  "metadata": { "applicationId": "case-1234", "traceId": "req-abc" },

  "inputs": {
    // Operational context. These don't come from the
    // HouseholdDeterminationRequest body — they're administrative
    // facts about the application itself ("when did this case file?",
    // "is this a recertification?") that your integration sets.
    "/applicationFilingDate":          "2025-01-05",
    "/benefitMonth":                   "2025-01-01",
    "/certificationPeriodStartDate":   "2025-01-01",
    "/isApplicationForRecertification": false,
    "/receivedSnapInLast30Days":       false,
    "/livesInApplicationCounty":       true,
    "/dSnapActive":                    false,
    "/temporaryEmergencyActive":       false,
    "/hasOrExpectsShelterCosts":       false,
    "/normalIssuanceCycleDate":        "2025-01-15",
    // ... 7 more operational booleans, all defaulting to false

    // Each member from the adapter request becomes one row here. Reuse
    // the adapter `id` as the row id so the response can refer back to
    // the same handle.
    "/members": [
      {
        "id": "head",
        "/members/*/age": 35,                                    // computed from dateOfBirth
        "/members/*/citizenshipImmigrationStatus": "Citizen",    // mapped from citizenshipStatus
        "/members/*/isHeadOfHousehold": true,                    // from relationshipToHead
        "/members/*/hasPhysicalDisability": false,               // from isDisabled
        "/members/*/preparesFoodWithHousehold": true,            // default
        "/members/*/studentEnrollmentStatus": "LessThanHalfTimeOrNotEnrolled"
        // ... ~80 other Boolean flags default to false; full list
        //     viewable on the /schema endpoint.
      }
    ],

    // Each member's income[] fans out into /incomes rows with a
    // memberId pointing back at the member. For earned income,
    // snap-complete also expects a sibling /jobs row.
    "/incomes": [
      {
        "id": "head-wages",
        "/incomes/*/memberId":  "head",
        "/incomes/*/type":      "WagesAndSalaries",
        "/incomes/*/amount":    1200,
        "/incomes/*/frequency": "Monthly",
        "/incomes/*/receivedBeforeSnapParticipation": false,
        "/incomes/*/isFromTerminatedSourceForDestituteIncome": false,
        "/incomes/*/isFromNewSourceForDestituteIncome": false
      }
    ],
    "/jobs": [
      {
        "id": "head-job",
        "/jobs/*/memberId":              "head",
        "/jobs/*/hoursPerWeek":          30,
        "/jobs/*/abawdWorkType":         "CompensatedWork",
        "/jobs/*/isSelfEmployed":        false,
        "/jobs/*/isAtFederalMinimumWage": false,
        "/jobs/*/offerAccepted":         true
        // ... ~10 other Boolean flags default to false
      }
    ],

    // expenses[] → /expenses rows. Each one declares its `type`
    // (Rent, Mortgage, Electricity, ChildSupport, …) from
    // /expenseTypeOptions. snap-complete uses these to compute the
    // shelter deduction, dependent-care deduction, etc.
    "/expenses": [
      {
        "id": "head-rent",
        "/expenses/*/memberId":  "head",
        "/expenses/*/type":      "Rent",
        "/expenses/*/amount":    800,
        "/expenses/*/frequency": "Monthly",
        "/expenses/*/isForClaimableShelterResidence": true,
        "/expenses/*/reimbursementAmount": 0
        // ... ~8 other Boolean flags default to false
      }
    ],

    // assets[] → /resourceItems rows. The asset categories in your
    // adapter (`liquid`, `vehicle`, ...) map onto a richer enum here
    // (CashOnHand, CheckingAccount, SavingsAccount, Stocks, ...).
    // See /resourceItemTypeOptions on the schema endpoint for the
    // full list.
    "/resourceItems": [
      {
        "id": "head-checking",
        "/resourceItems/*/memberId": "head",
        "/resourceItems/*/type":     "CheckingAccount",
        "/resourceItems/*/value":    500
      }
    ]
  }
}
```

The fan-out is the key insight: the nested `members[i].income[]`,
`expenses[]`, and `assets[]` arrays from your adapter request collapse
into separate top-level collections here (`/incomes`, `/expenses`,
`/resourceItems`), each row carrying a `memberId` cross-reference.
snap-complete also expects a `/jobs` row per earned-income source to
capture work-requirement data (hours per week, ABAWD work type, etc.)
that the adapter request doesn't currently carry.

A ready-to-use full request body lives at
[`data/factgraph/snap-complete/profiles.json`](../../../data/factgraph/snap-complete/profiles.json)
under the "Default" profile — copy its `inputs` block and merge in the
collections from the same profile's `entities` block (the profile file
still uses the older two-field shape; combine them under `inputs` when
building the query body), then patch in the applicant data from your
`HouseholdDeterminationRequest`.

## Step 2 — call the API

```sh
curl -X POST .../v1/factgraph/snap-complete/query \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d @./request.json
```

Verified response from prod for the request above:

```json
{
  "status": "complete",
  "rulesetVersion": "snap-complete",
  "metadata": { "applicationId": "case-1234", "traceId": "req-abc" },
  "values": {
    "/isExpedited": false,
    "/eligibilityCategory": "Ece",
    "/allotment": 221,
    "/proratedAllotment": 192
  }
}
```

The applicant qualifies via **Expanded Categorical Eligibility (ECE)**
with a $221/month allotment, prorated to $192 for the initial benefit
month. Not expedited (the household has > $0 in liquid resources and
income above the destitute threshold).

## Step 3 — map back to a `ProgramDecision`

Use `/eligibilityCategory` as the primary signal; lift the allotment
straight from `/allotment`.

```typescript
function toProgramDecision(query: QueryResponse): ProgramDecision {
  const category = query.values["/eligibilityCategory"];
  const allotment = query.values["/allotment"];

  // status mapping
  let status: ProgramDecision["status"];
  if (category === "Bce" || category === "Ece" || category === "Se") {
    status = "approved";
  } else if (category === "Ineligible") {
    status = "denied";  // or "ineligible" if you distinguish them
  } else {
    status = "pending"; // null value — engine couldn't resolve
  }

  return {
    metadata: query.metadata,
    program: "snap",
    status,
    path: "auto",
    denialReasonCode: status === "approved" ? undefined : deriveReason(query),
    // Plus your own extension fields for allotment, prorated, expedited
  };
}
```

For this applicant, `category === "Ece"` → `status: "approved"`.

## Variations from this baseline

Starting from the working scenario above, the common cases reduce to
patching a few fields and re-running.

### Higher income → potential denial

Bump `/incomes[0].amount` to a wage that exceeds the gross-income
threshold for a household of size 1, set `include: ["trace"]`, and
the response's `/eligibilityCategory` will eventually flip to
`"Ineligible"`. The trace then shows the deciding gate
(`/meetsGrossIncomeTest`) with a comparison leaf in its `reason`
field — *"Gross income ($X) > gross income threshold ($1,316) — did
not hold."*

Use the `decidingPaths["/eligibilityCategory"]` chain to produce a
structured `denialReasonCode`:

```typescript
const reason: Record<string, string> = {
  "/meetsGrossIncomeTest":      "FAILED_GROSS_INCOME_TEST",
  "/meetsNetIncomeTest":        "FAILED_NET_INCOME_TEST",
  "/meetsResourceTest":         "FAILED_RESOURCE_TEST",
  "/disqualifiedForBCE":        "DISQUALIFIED_BROAD_CATEGORICAL",
  "/meetsNonFinancialCriteria": "FAILED_NON_FINANCIAL",
}
const decidingFact = response.decidingPaths["/eligibilityCategory"].at(-1)
const denialReasonCode = reason[decidingFact?.path ?? ""] ?? "OTHER"
```

The full `traces["/eligibilityCategory"]` tree is always available
when you want to render the entire decision chain.

### Expedited screening

Your adapter contract has a separate `/evaluate/expedited-screening`
endpoint. Same `/v1/factgraph/...` call, just target only the
expedited fact and skip the heavier context:

```jsonc
{
  "targets": ["/isExpedited"],
  "inputs": {
    /* operational context */
    /* "/members": [...], "/incomes": [...], "/resourceItems": [...] */
  }
}
```

Returns `{ "values": { "/isExpedited": true | false } }`. Map to
`ExpeditedScreeningResponse.expedited`. Expedited fires under 7 CFR
§273.2(i) when liquid resources are at/below $100 and gross monthly
income is at/below $150 (homeless-shelter and migrant farm-worker
cases have additional thresholds — the engine handles those if
`/members/*/isMigrantFarmWorker` or
`/members/*/isExperiencingHomelessness` is set).

### Multi-member household

Add additional rows to `/members`, and add per-member rows to
`/incomes`, `/jobs`, `/expenses`, `/resourceItems` with
`/<collection>/*/memberId` pointing at the right `id`. The engine
applies the right deduction limits and household-size lookups
automatically.

## The fields the adapter request doesn't carry

`snap-complete` has ~80 per-member Boolean disqualifier flags — drug
felony convictions, IPV disqualifications, voluntary quit findings,
striker status, fleeing felon, work-requirement sanctions, and so on.
The `HouseholdDeterminationRequest` schema doesn't include these
fields, so the values have to come from somewhere else when building
the query body.

Some of these may map onto data you already collect (criminal records
checks, employment history, labor-dispute status). Others are
verification outcomes that don't exist until a caseworker has reviewed
the case — for those, the value at intake is genuinely unknown.

Because `snap-complete` expects every flag as a concrete Boolean (no
native "unknown" representation), the practical choice is to pick a
defaulting policy. Two common ones:

- **Default unknown flags to `false`.** Equivalent to "assume the
  applicant is not disqualified for this reason." Produces an
  eligibility result based on the criteria you *do* have data for,
  and surfaces a problem only if a caseworker later flips a flag and
  re-queries. Be aware: a result computed this way is conditional on
  those flags being false in reality. If most of your applicants
  aren't actually disqualified for these reasons, this is fine; if
  disqualifiers are common in your population, this will produce
  false-positive eligibility.
- **Front-load a verification step.** Don't call `snap-complete` until
  your caseworker workflow has produced concrete values for the
  disqualifier flags relevant to the case. Closer to a
  verification-driven adapter model where the call to this API only
  happens after the partner system has gathered enough information
  for a real determination.

Pick whichever matches your application's workflow. The schema
endpoint (`/v1/factgraph/snap-complete/schema`, filtered to writable
nodes under `/members/*/`) lists every flag with its description; the
[interactive docs](https://rules-visualizer-factgraph-api-f0c14673cf3a.herokuapp.com/v1/factgraph/docs)
are the easiest place to browse them.

## Mapping table — adapter fields → `/query` fields

Field-by-field translation for codegen or hand-rolled mapping:

| Adapter field | Query body location | Notes |
| --- | --- | --- |
| `metadata` | `metadata` | Echoed unchanged. |
| `program` | (implicit in URL) | `snap-complete` is the ruleset path component. |
| `household.size` | (derived from `/members[].length`) | Not provided directly; the engine counts non-disqualified `/members`. |
| `household.housingCosts` | `/expenses[]` with `type: "Rent"` or `"Mortgage"` | Split by type in this model. |
| `household.utilityCosts` | `/expenses[]` with utility types | Heating/cooling, electric, water etc. are each separate `/expenses` entries with `type` set. |
| `members[i].dateOfBirth` | (compute age) → `/members/*/age` | The engine uses age in years. |
| `members[i].citizenshipStatus` | `/members/*/citizenshipImmigrationStatus` | Enum — see `/citizenshipImmigrationStatusOptions` on the schema for the full list. |
| `members[i].relationshipToHead` | `/members/*/isHeadOfHousehold` | Boolean only; head/non-head. |
| `members[i].isDisabled` | `/members/*/hasPhysicalDisability` *or* `/hasMentalDisability` | One Boolean per type. |
| `members[i].income[]` | `/incomes` rows with `/incomes/*/memberId` linking back | Each income type → an `/incomes/*/type` enum value. |
| `members[i].expenses[]` | `/expenses` rows | Each expense category → an `/expenses/*/type` enum value. |
| `members[i].assets[]` | `/resourceItems` rows | Each asset type → a `/resourceItems/*/type` enum value. |
| (operational fields) | various scalar inputs | `applicationFilingDate`, `benefitMonth`, `livesInApplicationCounty`, etc. — administrative facts about the application itself, not about the applicant. Your integration sets these. |

For the enum mappings (income types, expense categories, citizenship
statuses), pull the option list from
`/v1/factgraph/snap-complete/schema` — every Enum writable carries an
`enumOptions` array.

---

## Operational notes

- **Frequency normalization happens server-side.** The `/incomes` and
  `/expenses` collections each have a `frequency` enum (Monthly,
  Weekly, BiWeekly, …). Pass through whatever frequency the source
  data has; the engine handles the conversion to monthly internally.
- **`memberId` cross-references use the positional `#N` form.** When a
  row references a member (e.g. `/incomes/*/memberId`,
  `/expenses/*/memberId`), set the value to `#N`, where `N` is the
  member's zero-based index in the `/members` array (`#0` = first member).
  The engine resolves member identity positionally; an id-**string** value
  (e.g. `"head"`) is **not** resolved on the `/query` endpoint today — the
  row silently attaches to no member, so its income/expense computes to
  `0` and you get a wrong-but-plausible result. (The `/v1/eligibility`
  adapter endpoints handle this for you: they accept human member `id`s
  and translate to `#N` internally.)
- **`include: ["trace"]` gives you the `denialReasonCode` material.**
  When set, the response includes
  `decidingPaths["/eligibilityCategory"]` (a flat chain of the deciding
  gates) and `traces["/eligibilityCategory"]` (the full tree). The
  `reason` field on each `TraceNode` is safe to render directly in a
  caseworker UI.
- **`/v1/factgraph/snap-complete/docs`** in a browser is the
  interactive reference — click Authorize, paste your token, click
  "Try it" against any of these scenarios. The [public docs
  site](https://gary-community-ventures.github.io/rules-visualizer/)
  has the same content statically, no token needed.

## Known limitations

- **SNAP-shaped convenience endpoints now exist.** The
  `/v1/eligibility/evaluate/*` adapter endpoints (see the **Eligibility
  Adapter** tag in the OpenAPI docs) wrap the translation in this
  walkthrough behind the contract's URL shape — send a
  `HouseholdDeterminationRequest` / `ExpeditedScreeningRequest`, get a
  `ProgramDecision` / `ExpeditedScreeningResponse`. The generic
  `POST /v1/factgraph/{rulesetId}/query` remains available for advanced or
  tooling use where you want direct access to targets, traces, and
  per-fact values.
- **Per-member trace** for collection-scoped targets isn't built yet.
  Per-member outputs come back as `[{memberId, value}]` arrays in
  `values`, but `traces` only walks scalar targets today.
- **Alternation** in `missingInputs`: when an `Any(...)` could be
  satisfied by *one of* several inputs, both branches' inputs appear
  in the list without an explicit "one-of" relationship. Either input
  unblocks the determination — the list just doesn't flag that yet.

See [`docs/changelog.md`](./changelog.md) for the full current state
and [`docs/concepts.md`](./concepts.md) for the contract semantics.
