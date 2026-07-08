# v1 conformance — eligibility adapter vs. the published contract

How exactly `/v1/eligibility` conforms to the
[published eligibility-adapter contract](https://github.com/codeforamerica/safety-net-blueprint/blob/main/packages/contracts/eligibility-adapter-openapi.yaml),
verified against the contract's schemas (`member.yaml`, `household.yaml`,
`income.yaml`, `eligibility.yaml`, `adapter.yaml`) and covered by
contract-exact request fixtures in `tests/eligibility.test.ts`.

**Legend:** ✅ conformant · ✅⁺ conformant, more lenient (accepts everything
the contract allows, plus more) · ⚠️ deliberate deviation (rationale given) ·
🔎 finding in the published contract itself.

## Endpoints

| Contract | Ours | Status |
|---|---|---|
| `POST /evaluate/determination` (oneOf Individual / Household) | Both shapes accepted | ✅ (see notes below) |
| `POST /evaluate/expedited-screening` (household-only) | Household-only accepted; member context as sanctioned overlay | ✅ |
| `POST /evaluate/medicaid-ex-parte` | `501` | ⚠️ pending three contract clarifications — see [gap analysis](./contract-gap-analysis.md) |

## Request handling

| Contract says | We do | Status |
|---|---|---|
| `metadata` optional on request; adapter must echo unchanged, never inspect | Echoed verbatim; `{}` when absent; never read | ✅ |
| `member` has **no required fields** (and no `id`) | All member fields optional; absent `id` → positional `member-N` handle; absent `dateOfBirth` → defaulted age, disclosed | ✅ |
| `household.size` required | Accepted but not required; size derived from `members[]` when present | ✅⁺ |
| `household.housingCosts` / `utilityCosts` "used in benefit calculation / expedited screening" | Applied as monthly shelter/utility expenses when no member-level expense covers them, disclosed in `x-translationNotes` | ✅ |
| `income` requires `type`, `amount`, `frequency` | `amount` required; `type`/`frequency` defaulted with disclosure when absent | ✅⁺ |
| `member.employment[]` | `hoursPerWeek` consumed (SNAP work requirements); other fields accepted | ✅ |
| `member.healthCoverage[]`, `immigrationInfo` | Accepted, not consumed (no SNAP/Medicaid rule reads them today) | ✅⁺ |
| `verificationSummary` required on determination requests | Accepted, optional | ✅⁺ |
| `IndividualDeterminationRequest` (single `member`, no household) for medicaid | Accepted; wrapped as a household whose only known member is the applicant, **assumption disclosed** in `x-translationNotes` (MAGI results depend on the full household — an orchestration layer holding the case record should send the whole household) | ✅ with caveat |

## Response handling

| Contract says | We do | Status |
|---|---|---|
| `ProgramDecision`: `metadata` (required), `program`, `status`, `path`, `denialReasonCode` | All present | ✅ |
| `DecisionStatus`: `pending \| approved \| denied \| ineligible`; denied = failed test (appealable), ineligible = categorical bar | Mapped exactly, including the denied/ineligible distinction | ✅ |
| `denialReasonCode`: machine-readable, state-defined | snake_case codes (`failed_gross_income_test`, …) | ✅ |
| `additionalProperties: true` on responses | Additive `x-` overlays only: `x-allotment`, `x-proratedAllotment`, `x-expedited`, `x-missingInformation`, `x-translationNotes`, `x-explanation` | ✅ |
| `ExpeditedScreeningResponse`: `{metadata, expedited}` | Plus `x-missingInformation` when the screen was uncomputable (then `expedited` is a conservative `false`) | ✅ |
| Medicaid determination returns one `ProgramDecision` | Returns `MedicaidDeterminationResponse` with one decision **per member** | ⚠️ deliberate: MAGI is household-in / per-member-out; a per-applicant answer computed without household context would be wrong. Documented in the [gap analysis](./contract-gap-analysis.md) |

## Findings in the published contract (reported, not worked around silently)

1. 🔎 **Expedited screening is uncomputable from the contract-exact request.**
   The request is household-only, and `household` carries no income or
   liquid-resource fields — yet 7 CFR §273.2(i) compares exactly those
   against housing+utility costs. Conformant callers receive
   `expedited: false` + `x-missingInformation` naming what's needed.
2. 🔎 **`path: ex_parte` in the contract's example is invalid against its own
   `DecisionPath` enum** (`[auto, manual]`).
3. 🔎 **No benefit-amount field** — an approval can't say *for how much*
   (carried as `x-allotment` meanwhile).
4. 🔎 **`isDisabled` is ambiguous across programs** (different legal
   definitions); the decomposed, self-attestable facts are proposed in the
   [v2 draft](./eligibility-v2-openapi.yaml).

See [contract-gap-analysis.md](./contract-gap-analysis.md) for the full
discussion and proposals.
