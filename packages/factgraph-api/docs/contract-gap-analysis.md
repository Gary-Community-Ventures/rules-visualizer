# Contract-gap analysis: ORCA eligibility-adapter ↔ our SNAP & Medicaid graphs

**Status: Draft for discussion with the Worker Portal / safety-net-blueprint team.**

This compares what the partner's eligibility-adapter contract supplies
(the ORCA data model) against what our Fact Graph rulesets actually need
to produce a correct determination, for both programs in the Steel Thread.

Contract reference:
[`eligibility-adapter-openapi.yaml`](https://github.com/codeforamerica/safety-net-blueprint/blob/main/packages/contracts/eligibility-adapter-openapi.yaml)
and the shared member/income/expense/asset schemas under
[`schemas/common/`](https://github.com/codeforamerica/safety-net-blueprint/tree/main/packages/contracts/schemas/common).

**Legend**

| | meaning |
|---|---|
| ✅ Covered | ORCA already carries it; direct map |
| ⚙️ Derive | adapter computes it from ORCA fields — no contract change |
| ➕ Add | propose adding to the ORCA contract; collectable at intake |
| 🔎 Verify | caseworker-verification outcome; belongs in `verificationSummary`, not the request — determination returns `pending` until supplied |
| ⏱ AppCtx | application/case metadata, not a member attribute at all |

---

## Headline findings

1. **Medicaid is "household in → per-member out", not per-applicant.** The
   contract models medicaid as an `IndividualDeterminationRequest` carrying
   a single `member`. But MAGI Medicaid/CHP eligibility for any one person
   depends on the **whole household** (size + aggregate income → FPL%). You
   cannot determine one member from their data alone. See
   [Medicaid cardinality](#medicaid-cardinality-the-important-one) below —
   this is the most important contract change to discuss.

2. **SNAP's "missing" inputs are two different things.** Of snap-complete's
   167 inputs, the large tail of per-member flags splits cleanly into
   **➕ collectable-at-intake** (extend the member shape) vs **🔎
   verification-only** (caseworker findings that belong in
   `verificationSummary` and should drive a `pending` status, never a
   silent `false` default). Conflating them is what makes the current
   adapter's defaulting unsafe.

3. **Application/case metadata isn't a member concern.** ~16 SNAP scalars
   (filing date, benefit month, certification period, county, disaster
   flags) are case context the integration sets — they need a small
   `applicationContext` block, and are currently hardcoded (a defect).

---

## Medicaid

### Medicaid cardinality (the important one)

Our medicaid graph takes **household-level** income (`/earnedIncome`,
`/unearnedIncome`) plus a `/members` collection, derives `householdSize` and
`totalIncome`, computes `medicaidFplPercent`, and then emits a **per-member**
result: `/members/*/medicaid` (bool), `/members/*/medicaidCategory`
(`Infant | YoungChild | OlderChild | Adult | Pregnant | SsiRecipient | Ineligible`),
and `/members/*/chp`.

So the natural shape is:

> **input = household + all members → output = one decision per member.**

That contradicts the contract's `IndividualDeterminationRequest` (a single
`member`, no household). Clean way to frame the difference for the contract:

| Program | Input | Output cardinality |
|---|---|---|
| **SNAP** | household + members | **1** decision for the household unit |
| **Medicaid / CHP** | household + members | **N** decisions, one per member |

**Recommendation:** medicaid determination should accept a **household-shaped
request** (like SNAP's `HouseholdDeterminationRequest`) and return a
**per-member result set**. If the contract wants to keep "one decision per
call", pass the full household **plus** a `subjectMemberId` and return that
member's decision computed against the household — but the household context
must travel either way.

> **Implemented (the per-member form):** `POST /v1/eligibility/evaluate/determination`
> with `program: "medicaid"` takes a household-shaped request and returns a
> `MedicaidDeterminationResponse` with one decision per member — live and
> testable. It also accepts the contract's per-applicant
> `IndividualDeterminationRequest` (single `member`), wrapping it as a
> sole-applicant household with that assumption disclosed. The
> `subjectMemberId` "one decision per call" variant is part of the **v2
> proposal**, not implemented in v1. This section is the rationale + the
> contract change we're proposing back to the blueprint.

### Medicaid input coverage (13 inputs)

| Graph input | Source | Bucket |
|---|---|---|
| `age` | `dateOfBirth` | ✅ Covered |
| `disabled` | `isDisabled` | ✅ Covered |
| `immigrantStatus` | `citizenshipStatus` + `immigrationStatus` | ✅ Covered (enum map) |
| `earnedIncome`, `unearnedIncome` (household) | sum `members[].income[]` by `type` | ⚙️ Derive |
| `monthlyHoursWorked` | `employment[].hoursPerWeek` × 4.33 | ⚙️ Derive |
| `receivesSsi` | `income[].unearnedType == ssi_or_ssdi` | ⚙️ Derive — ⚠️ ORCA conflates SSI+SSDI; the `SsiRecipient` category wants SSI specifically |
| `pregnant` (children due) | — | ➕ Add |
| `daysSincePregnancy` | — | ➕ Add |
| `veteran` | — | ➕ Add |
| `isFullTimeStudent` | — | ➕ Add (employment enum has no "student") |
| `hasDisabledChild` | — | ➕ Add |

**Medicaid ask:** add **5 member fields** (`pregnant`, `daysSincePregnancy`,
`veteranStatus`, `isFullTimeStudent`, `hasDisabledChild`); resolve the
cardinality question. Everything else is covered or derivable.

### Medicaid ex parte

Ex parte (42 CFR §435.916) is **not different eligibility math** — it is the
same MAGI determination reached through a different evidentiary pathway:
determine from information already available (electronic data exchange),
without asking the applicant for documentation. The same medicaid graph
computes the answer; what differs is a thin workflow wrapper:

1. **Conclusiveness gate.** Each `electronicChecks[]` entry carries
   `result: conclusive | inconclusive | partial | error`. Ex parte's defining
   constraint is that the applicant can't be asked for more — so any required
   check that isn't `conclusive` ⇒ `status: pending` (falls to the regular
   process). This belongs in the adapter, not the rules.
2. **Input provenance.** Facts arrive via data exchange (`fdsh_fti` → income,
   `fdsh_ssa`/`ssa_ievs` → SSI, `fdsh_vlp`/`save` → immigration status)
   rather than caseworker entry. Note MAGI's household is essentially the tax
   unit, so FTI income aligns naturally with the graph's household-level
   income inputs.

**Why it isn't implemented yet — confirmations to align on, no engine gaps:**

- **Division of labor (already largely agreed).** The established model is
  that the rules engine receives the facts it needs *as input*, while the
  orchestration/adapter layer performs the federal call-outs and passes the
  results in — the engine does not call external services or parse their raw
  payloads. Read that way, ex parte is straightforward: the `member` context
  carries the extracted facts (income, SSI status, immigration status), and
  `electronicChecks[]` supplies the per-check *conclusiveness* status the
  adapter needs for the gate; the `serviceResult` payloads are treated as
  opaque. So the empty `serviceResult` schemas in
  `data-exchange-adapter-openapi.yaml` are **not a blocker for the engine** —
  we just want to confirm that division holds for ex parte specifically.
- **Household context.** The request carries one member and no household, but
  MAGI needs household size + income — the same point as the per-applicant
  determination (above). A per-applicant ex parte call needs household
  context to resolve.
- **`path: ex_parte` vs the enum.** The example response returns
  `path: ex_parte`, but `DecisionPath` is `[auto, manual]` — and the enum's
  own description cites Medicaid ex parte as an example of `auto`. So the
  example is internally inconsistent: either it should be `auto` (a doc fix),
  or `ex_parte` is an intended, more-informative third value (an enum
  addition). Adapters need to know which.

Once those are confirmed the implementation is small — conclusiveness gate →
the existing medicaid translator → the same graph → decision. The endpoint
returns `501` until then, and the structure stays "one medicaid graph, two
workflow endpoints" (mirroring SNAP's expedited-screening over
`snap-complete`).

---

## SNAP (snap-complete — 167 inputs)

### Member attributes (`/members/*`, ~84 fields)

**✅ Covered / partially covered by the ORCA member**

| Graph input | ORCA source | Note |
|---|---|---|
| `age` | `dateOfBirth` | ✅ |
| `citizenshipImmigrationStatus` | `citizenshipStatus` + `immigrationStatus` | ✅ enum map |
| `isHeadOfHousehold` | `relationshipToHead == head_of_household` | ✅ |
| `hasPhysicalDisability` | `isDisabled` | ⚠️ ORCA has one `isDisabled`; SNAP splits physical/mental/incapacitated |

**➕ Add — circumstances collectable at intake** (extend the ORCA member)

- *Disability detail:* `hasMentalDisability`, `isIncapacitated`, `isUnableToPurchaseAndPrepareOwnMealsDueToDisability`, `receivesTemporaryOrPermanentDisabilityBenefits`, `receivesPublicDisabilityRetirementPension`, `receivesRailroadRetirementDisability`, `receivesInterimAssistanceForDisability`, `isApplyingForOrAppealingSsiBenefits`, `isParticipatingInVocationalRehabilitation`
- *Veteran:* `isVeteran`, `isVeteranWithDisability`, `isVeteranNeedingAidAndAttendance`, `isVeteranSurvivorNeedingAidAndAttendance`, `isVeteranSurvivorWithDisability`
- *Pregnancy:* `isPregnant`
- *Living arrangement:* `isBoarder`, `isRoomer`, `livesInBoardingHouse`, `livesInInstitution`, `livesInFederallySubsidizedElderlyHousing`, `residesAtSubstanceAbuseTreatmentFacility`, `livesInHomelessShelter`, `isExperiencingHomelessness`, `livesInGroupLivingArrangement`, `isLiveInAttendant`, `isSeparateAndApart`, `isResidentOfBatteredWomensShelter`, `recentlyReleasedFromInstitution`, `preparesFoodWithHousehold`, `isParticipatingInAnotherHousehold`
- *Household role:* `isEmancipated`, `isFosterChild`, `wasInFosterCareOn18thBirthday`, `receivesFamilyPreservationServices`, `receivesTanf`
- *Student status:* `studentEnrollmentStatus`, `isInK12`, `isParticipatingInWorkStudy`, `isAssignedToHigherEducationThroughEmploymentTrainingProgram`, `isPhysicallyOrMentallyUnfitForEmploymentForStudentEligibility`
- *Work registration / ABAWD:* `registeredForWork`, `providedEmploymentStatusOrAvailabilityInfo`, `reportedToReferredSuitableEmployer`, `isEnrolledInEmploymentTrainingProgram`, `isApplyingForOrReceivingUnemploymentInsuranceBenefits`, `isRegularParticipantInDrugOrAlcoholTreatment`, `isComplyingWithColoradoWorksOrRefugeeServicesWorkProgram`, `isExemptUnderAbawdWaiver`, `isExemptUnderColoradoAbawdStateExemption`, `abawdWorkProgramHoursPerWeek`, `participatesInColoradoWorkfare`, `isUnableToMaintainEmployment`, `isImpactedByDomesticViolence`, `hasOtherValidReasonForWorkRequirementsUnfitness`, `hasSelfDeclaredTemporaryConditionPreventingWorkActivities`
- *Migrant / strike:* `isMigrantFarmWorker`, `isStriker`, `wasEligibleForSnapDayBeforeStrike`, `wasExemptFromWorkRegistrationDayBeforeStrike`
- *Immigration detail:* `qualifiedYearsInUs`, `qualifyingWorkQuarters`, `wasBornOnOrBeforeAug221931AndLawfullyResidedAug221996`, `hasQualifyingMilitaryConnection`, `sponsorAndSpouseDependentCount`, `sponsoredNonCitizenCountOutsideHousehold`, `isSponsoredByOrganization`

**🔎 Verify — caseworker findings** (→ `verificationSummary`; `pending` until known, never default `false`)

- `disqualifiedForIPV`, `convictedOfDrugRelatedFelonyWithSnap`, `failedToProvideOrObtainSSN`, `disqualifiedForWorkRequirementsCooperation`, `voluntarilyQuitOrReducedWorkEffort` (+ `voluntaryQuitReason`), `disqualifiedForQualityAssuranceCooperation`, `disqualifiedForFelonyNonCompliance`, `disqualifiedForParoleOrProbationViolation`, `isFleeingFelon`, `hasLevelSanctionImposed`, `countableMonths` (ABAWD time-clock — administrative history)

**⚙️ Reference fields:** `spouseId`, `sponsorId` (CollectionItem refs — set from household relationships).

### Financial collections (fully enumerated)

**`/incomes` (13)** — ORCA `income[]` covers the core; the rest is SNAP destitute-income / exclusion detail.

- ✅ `type`, `amount`, `frequency` (← `income[]`); ⚙️ `memberId` (positional ref)
- ➕ `targetPayDate`, `intendedMonths`, `receivedBeforeSnapParticipation`, `isWorkSupplementationOrWorkSupportPublicAssistancePortion`, `isFromTerminatedSourceForDestituteIncome`, `isFromNewSourceForDestituteIncome`, `otherExcludedIncomeType`, `needBasedNonprofitCashDonationQuarterlyExclusionUsed`, `indianTrustRestrictedLandInterestAnnualExclusionUsed`

**`/expenses` (16)** — ORCA `expenses[]` covers the core; the rest is SNAP shelter / utility / dependent-care deduction detail.

- ✅ `type`, `amount`, `frequency` (← `expenses[]`); ⚙️ `memberId`
- ➕ `reimbursementAmount`, `shouldAverage`, `intendedMonths`, `milesDrivenToDependentCareFacility`, `milesDrivenForMedicalTreatment`, `isNecessaryDependentCareForWorkTrainingOrEducation`, `isDirectMonetaryPaymentToAgencyOrPersonOutsideHousehold`, `isForClaimableShelterResidence`, `incursOrAnticipatesSeparateHeatingCoolingCosts`, `privateRentalBilledForHeatingCooling`, `sharedResidencePaysHeatingCoolingPortion`, `publicHousingResponsibleForExcessHeatingCoolingCosts`

**`/resourceItems` (4)** — essentially covered by ORCA `assets[]`.

- ✅ `type`, `value` (← `assets[]`); ⚙️ `memberId`; ➕ `otherExcludedResourceType`

**`/jobs` (18)** — the **largest SNAP gap**. ORCA `employment[]` gives only hours/status; the rest is ABAWD work-type + "good cause to quit/refuse" conditions with no ORCA equivalent.

- ✅/⚙️ `hoursPerWeek` (← `employment[].hoursPerWeek`), `isSelfEmployed` (← `employment.status == self_employed`); ⚙️ `memberId`
- ➕ `abawdWorkType`, `isAtFederalMinimumWage`, `isOnTheJobTraining`, `offerAccepted`, `wagesBelowApplicableMinimum`, `pieceRateYieldBelowApplicableWage`, `requiresLaborOrganizationAction`, `worksiteSubjectToStrikeOrLockout`, `unreasonableHealthSafetyRisk`, `memberPhysicallyOrMentallyUnfit`, `outsideMajorFieldDuringInitialThirtyDays`, `unreasonableDistance`, `dailyCommuteExceedsTwoHours`, `noTransportationForNonWalkingDistance`, `interferesWithReligiousObservance`

**`/caregiverRelationships` (7)** — no ORCA equivalent; dependent-care relationships used for work-requirement exemptions.

- ➕ `caregiverId`, `dependentId` (CollectionItem refs), `isParent`, `isNonparentParentalControl`, `caregiverProvidesMoreThanHalfOfPhysicalCare`, `adequateChildcareUnavailable`, `claimedForWorkRequirementsCareExemption`

### ⏱ Application / case context (SNAP scalars — not member fields)

Propose a small `applicationContext` block; the integration sets these from
the case record (currently hardcoded — a defect):

`applicationFilingDate`, `benefitMonth`, `certificationPeriodStartDate`,
`normalIssuanceCycleDate`, `isApplicationForRecertification`,
`receivedSnapInLast30Days`, `livesInApplicationCounty`,
`hasNearbyCountyArrangement`, plus program/admin state (`dSnapActive`,
`temporaryEmergencyActive`, `isPresidentiallyDeclaredDisasterOrEmergency`,
`receivesLeapInLast12Months`, `hasEebtInLast12Months`,
`participatesInCommodityFoodDistributionProgram`, `hasOrExpectsShelterCosts`,
`hadPreviousSubstantialLotteryOrGamblingWinnings`,
`hasInadvertentHouseholdErrorClaimDueToEarnedIncomeCalculation`).

---

## Proposed talking points for the partner

1. **Medicaid:** change the determination shape to household-in / per-member-out
   (or carry household context on the per-applicant call). Add 5 member fields.
2. **SNAP member shape:** add the ➕ circumstance fields (domain-shaped, not
   raw Fact Graph paths). Agree the exact ✅/➕/🔎 line with the rule authors.
3. **`verificationSummary`:** the 🔎 fields are exactly what this is for — and
   the adapter should return `pending` + `x-missingInformation` for them
   rather than defaulting, which is the structured-missing-info behavior the
   contract already asked us for.
4. **`applicationContext`:** add a case-metadata block; stop hardcoding dates.
5. **`/jobs` + `/caregiverRelationships`:** flag as the biggest SNAP gaps — the
   ORCA `employment[]` shape is far thinner than SNAP work-requirement logic needs.
6. **`ProgramDecision` has no benefit-amount field.** The response vocabulary
   is `status` / `path` / `denialReasonCode` — it can say "approved" but not
   "approved *for how much*," and a SNAP approval without an allotment isn't
   actionable for a caseworker. Our adapter currently carries the amounts as
   overlay extensions (`x-allotment`, `x-proratedAllotment`); propose
   promoting them into the contract as `benefitAmount` and an optional
   `proratedFirstMonthAmount` (monthly dollars, present when status is
   `approved` for benefit-amount programs).
7. **Medicaid ex parte:** confirm (a) that the agreed division of labor holds
   — the orchestration layer does the federal call-outs and passes the facts
   in, so the engine treats `serviceResult` payloads as opaque and uses
   `electronicChecks[]` only for conclusiveness (no dependence on the empty
   per-service schemas); (b) the household-context question for the
   per-applicant call (same as #1); and (c) whether `path: ex_parte` in the
   example should be `auto` (matching the enum's own description) or a new
   enum value. The rules engine is ready — same medicaid graph, plus a
   conclusiveness gate in the adapter.

> The ✅/➕/🔎 buckets above are a first pass and should be confirmed against the
> rule authors' intent; some flags (e.g. striker status) are arguably either
> intake-collectable or verification-driven depending on the workflow.
