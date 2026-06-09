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

> **Implemented:** `POST /v1/eligibility/evaluate/determination` with
> `program: "medicaid"` now does exactly this — household-shaped request in, a
> `MedicaidDeterminationResponse` with one decision per member out. It's live
> and testable; this section is the rationale + the contract change we're
> proposing back to the blueprint.

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

`/evaluate/medicaid-ex-parte` does **not** map to this graph at all — it
determines eligibility from electronic-data-exchange results (FDSH FTI,
Medicare/VCI), a concept the graph has no inputs for. Stays `501` until/unless
that flow is modeled separately.

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

> The ✅/➕/🔎 buckets above are a first pass and should be confirmed against the
> rule authors' intent; some flags (e.g. striker status) are arguably either
> intake-collectable or verification-driven depending on the workflow.
