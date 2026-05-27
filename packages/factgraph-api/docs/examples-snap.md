# Worked example: SNAP eligibility

A walkthrough of how to drive `POST /v1/factgraph/{rulesetId}/query`
from a real partner integration. Two parts:

1. **Quick walkthrough** using the smaller `snap-fy2026` ruleset — a
   crisp introduction to the request/response shape.
2. **Real-world walkthrough** using `snap-complete` and the
   `HouseholdDeterminationRequest` shape from
   [`eligibility-adapter-openapi.yaml`](https://github.com/codeforamerica/safety-net-blueprint/blob/main/packages/contracts/eligibility-adapter-openapi.yaml).
   This is the integration the API was actually built for: take a
   household + members + income/expense/asset arrays as a partner has
   them, get back a `ProgramDecision`-shaped result.

## Which SNAP ruleset to use

The repo ships two SNAP rulesets. They have different shapes and
different purposes.

| Ruleset | Inputs | Source | When to use |
| --- | --- | --- | --- |
| **`snap-complete`** | ~17 scalar + ~142 per-member writables across five collections (`/members`, `/incomes`, `/expenses`, `/jobs`, `/resourceItems`) | Our team's modelling of the full Colorado SNAP rule (10 CCR 2506-1) | Production-grade determinations — eligibility category, expedited screening, allotment + prorated allotment, denial reasons |
| **`snap-fy2026`** | ~11 scalar + ~18 per-member writables, single `/members` collection | A subset modelled after PolicyEngine-US's `is_snap_eligible` covering the most common rules | Demos, quick experiments, prototypes where the full input surface would be a distraction |

Most of this doc uses `snap-complete` because that's what a real partner
integration will target. The quick walkthrough below uses `snap-fy2026`
because it's simpler to read.

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
  "values": { "/eligible": true, "/snap": 298 }
}
```

That's the whole request/response loop. Single person, zero income →
eligible, $298/month (FY2026 max allotment for one).

---

# Real-world walkthrough (snap-complete)

This is what a real integration looks like. We start with a
`HouseholdDeterminationRequest` shaped like the partner team's
`eligibility-adapter-openapi.yaml`, translate it into a call against
`/v1/factgraph/snap-complete/query`, and translate the response back
into a `ProgramDecision`.

## What you have to start with

Per the partner adapter contract, you receive a request like:

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

The mapping from the adapter shape to our `/query` body has three
moving parts: scalar context, the `/members` collection, and the
per-member arrays (income / expenses / assets) which fan out into
**separate** top-level collections on our side.

```jsonc
{
  // Same target list every call. We'll read every output we need
  // for the ProgramDecision from these four.
  "targets": [
    "/isExpedited",         // for the expedited-screening endpoint
    "/eligibilityCategory", // Bce | Ece | Se | Ineligible
    "/allotment",           // full month allotment
    "/proratedAllotment"    // partial first-month allotment
  ],

  // Echoed unchanged in the response.
  "metadata": { "applicationId": "case-1234", "traceId": "req-abc" },

  // Caseworker-side context. These don't come from the adapter request
  // body — they're operational ("when did this case file?") and your
  // integration owns them.
  "inputs": {
    "/applicationFilingDate":          "2025-01-05",
    "/benefitMonth":                   "2025-01-01",
    "/certificationPeriodStartDate":   "2025-01-01",
    "/isApplicationForRecertification": false,
    "/receivedSnapInLast30Days":       false,
    "/livesInApplicationCounty":       true,
    "/dSnapActive":                    false,
    "/temporaryEmergencyActive":       false,
    "/hasOrExpectsShelterCosts":       false,
    "/normalIssuanceCycleDate":        "2025-01-15"
    // ... 7 more operational booleans, all defaulting to false
  },

  "entities": {
    // Each member from the adapter request becomes one row here. The
    // partner's `id` is reused as our row id so the response can use
    // the same key.
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
    // memberId pointing back at the member. Snap-complete also expects
    // a sibling /jobs row for any earned income.
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
    // /expenseTypeOptions. Snap-complete uses these to compute the
    // shelter deduction, dependent-care deduction, and similar.
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

    // assets[] → /resourceItems rows. Asset categories map onto a
    // richer enum on our side (CashOnHand, CheckingAccount,
    // SavingsAccount, Stocks, ...) — see /resourceItemTypeOptions.
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

The fan-out is the key insight: the partner's nested
`members[i].income[]`, `expenses[]`, and `assets[]` arrays collapse
out into separate top-level collections on our side
(`/incomes`, `/expenses`, `/resourceItems`), each row carrying a
`memberId` cross-reference. Snap-complete also expects a `/jobs` row
per earned-income source to capture work-requirement data
(hours per week, ABAWD work type, etc.) that the adapter request
doesn't currently include.

A ready-to-use full request body lives at
[`data/factgraph/snap-complete/profiles.json`](../../../data/factgraph/snap-complete/profiles.json)
under the "Default" profile — copy the `inputs` and `entities` blocks
verbatim as your starting template, then patch in the partner data.

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

For our applicant: `category === "Ece"` → `status: "approved"`.

## Variations from this baseline

Iterating from the working scenario above, you can model any of the
common partner cases by patching a few fields and re-running.

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

The partner adapter spec has a separate
`/evaluate/expedited-screening` endpoint. Same `/v1/factgraph/...`
call, just target only the expedited fact and skip the heavier
context:

```jsonc
{
  "targets": ["/isExpedited"],
  "inputs":   { /* caseworker context */ },
  "entities": { /* members + incomes + resourceItems */ }
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

## The fields you don't have

The snap-complete ruleset has ~80 per-member Boolean disqualifier
flags (drug felony, IPV disqualification, voluntary quit, work
sanctions, ...) that a partner adapter request **doesn't carry**. The
contract treats these as "caseworker-known", not applicant-supplied.

For an integration call:

- **All flags default to `false`** in your request body (the safe
  initial-application assumption).
- When a caseworker reviews the case and discovers a disqualifier,
  flip the relevant flag(s) and re-run the query. The trace will
  show the new failing gate.

If you want to know which flags exist, hit
`/v1/factgraph/snap-complete/schema` and filter for
`writable, path.startsWith("/members/*/")` or browse the [interactive
docs](https://rules-visualizer-factgraph-api-f0c14673cf3a.herokuapp.com/v1/factgraph/docs).

## Mapping table — adapter fields → `/query` fields

For partner-side codegen, here's the field-by-field translation.

| Adapter field | Query body location | Notes |
| --- | --- | --- |
| `metadata` | `metadata` | Echoed unchanged. |
| `program` | (implicit in URL) | `snap-complete` is the ruleset path component. |
| `household.size` | (derived from `/members[].length`) | Not provided directly; the engine counts non-disqualified `/members`. |
| `household.housingCosts` | `/expenses[]` with `type: "Rent"` or `"Mortgage"` | Split by type in our model. |
| `household.utilityCosts` | `/expenses[]` with utility types | Heating/cooling, electric, water etc. are each separate `/expenses` entries with `type` set. |
| `members[i].dateOfBirth` | (compute age) → `/members/*/age` | Engine uses age in years. |
| `members[i].citizenshipStatus` | `/members/*/citizenshipImmigrationStatus` | Enum — see /citizenshipImmigrationStatusOptions on the schema for the full list. |
| `members[i].relationshipToHead` | `/members/*/isHeadOfHousehold` | Boolean only; head/non-head. |
| `members[i].isDisabled` | `/members/*/hasPhysicalDisability` *or* `/hasMentalDisability` | One Boolean per type. |
| `members[i].income[]` | `/incomes` rows with `/incomes/*/memberId` linking back | Each income type → an `/incomes/*/type` enum value. |
| `members[i].expenses[]` | `/expenses` rows | Each expense category → an `/expenses/*/type` enum value. |
| `members[i].assets[]` | `/resourceItems` rows | Each asset type → a `/resourceItems/*/type` enum value. |
| (caseworker-only fields) | various scalar inputs | `applicationFilingDate`, `benefitMonth`, `livesInApplicationCounty`, etc. Default to safe values. |

For the enum mappings (income types, expense categories, citizenship
statuses), pull the option list from
`/v1/factgraph/snap-complete/schema` — every Enum writable carries an
`enumOptions` array.

---

## Operational notes

- **Frequency normalization is the engine's job.** Our `/incomes` and
  `/expenses` have a `frequency` enum (Monthly, Weekly, BiWeekly, …).
  The engine handles the math; you pass what the partner gave you.
- **`memberId` cross-references.** When a row references a member
  (e.g. `/incomes/*/memberId`, `/expenses/*/memberId`), supply the
  partner's `id` string and we'll resolve it. You can also use the
  positional `#N` form (e.g. `"#0"` = first member) — both work.
- **Trace + `decidingPath` give you `denialReasonCode`.** Set
  `include: ["trace"]` on calls that need a reason; the
  `decidingPaths["/eligibilityCategory"]` chain shows you the deciding
  gate. The `reason` field on each `TraceNode` is safe to render
  directly in a caseworker UI.
- **`/v1/factgraph/snap-complete/docs`** in your browser is the
  interactive reference — click Authorize, paste your token, click
  "Try it" against any of these scenarios. The
  [GitHub Pages version](https://gary-community-ventures.github.io/rules-visualizer/)
  has the same content statically, no token needed.

## What's still rough

A few things we know are honest gaps as of this write:

- **No SNAP-shaped convenience endpoints yet.** Today every call goes
  through `POST /v1/factgraph/{rulesetId}/query`. A future
  `POST /evaluate/expedited-screening` and
  `POST /evaluate/determination` matching your adapter contract's URL
  shape is on the roadmap — when partners ask for it loudly enough.
- **Per-member trace** for collection-scoped targets isn't built yet.
  Per-member outputs come back as `[{memberId, value}]` arrays in
  `values`, but `traces` only walks scalar targets today.
- **Alternation** in `missingInputs`: when an `Any(...)` could be
  satisfied by *one of* several inputs, both branches' inputs appear
  in the list without an explicit "one-of" relationship.

See [`docs/changelog.md`](./changelog.md) for the full current state
and `docs/concepts.md` for the contract semantics.
