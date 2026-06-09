# Request-field proposal: a no-guess eligibility determination

**Status: Draft for internal review, then discussion with the State and the
Worker Portal team.**

This proposes the domain-shaped request fields the eligibility adapter needs
so a determination can be made **without the adapter guessing**. It is the
companion to [contract-gap-analysis.md](./contract-gap-analysis.md): that doc
identified *what's missing*; this one proposes *the field names and shapes*
to carry it, in the Worker Portal's conventions (camelCase properties,
snake_case enum values), so they're candidates for adoption into the shared
contract rather than adapter-only inventions.

## The no-guess policy

Today the adapter fills every field the request doesn't carry with a
"typical, non-disqualified applicant" default. That produces confident
determinations that are wrong whenever the assumption is — and wrong in the
dangerous direction (toward granting). Replacement policy:

1. **Derive, don't default.** Values computable from supplied data are
   computed: `age` ← `dateOfBirth`, monthly hours ← `employment[].hoursPerWeek`,
   `receivesSsi` ← income with `unearnedType: ssi_or_ssdi`. These are listed
   in `x-translationNotes` only when lossy (e.g. the SSI/SSDI conflation).
2. **Absence of a collection row is data.** An empty or absent `income[]`
   means "no income reported," not "income unknown." Same for `expenses[]`,
   `assets[]`, `employment[]`. This is a documented semantic of the contract.
3. **Evaluation context has documented operational semantics.** Absent
   `applicationContext`, the determination is evaluated **as of today** for a
   new (non-recertification) application. That is the meaning of calling the
   endpoint, not a guess about the applicant.
4. **Everything else: no value means `pending`.** Applicant-material
   attributes (pregnancy, student status, living situation, immigration
   detail, …) and caseworker findings are **never defaulted**. If the
   determination needs one and it wasn't supplied, the response is
   `status: pending` with the field listed in `x-missingInformation`.

The request/`pending` loop is the progressive-disclosure mechanism: send what
you have → learn exactly what's still needed → supply it → determine.

## Conventions

- Properties camelCase; enum values snake_case (Worker Portal conventions).
- Booleans are tri-state by **omission**: `true`/`false` are assertions;
  absent means unknown → may produce `pending`.
- Where the rules vocabulary is large (expense types ~78 values, resource
  types ~65), the proposal keeps the contract's **coarse category** and adds
  an optional `detailType` whose values come from the rules engine's
  published vocabulary — so the contract stays small while precision remains
  possible. Coarse categories map to a representative rules type; supplying
  `detailType` overrides.

---

## 1. Member-level additions (`members[i]`)

### `pregnancy`

| Field | Type | Maps to (graph) | Notes |
|---|---|---|---|
| `pregnancy.isPregnant` | boolean | `/members/*/isPregnant` | |
| `pregnancy.expectedChildren` | integer | medicaid `/members/*/pregnant` | Children due; adds to FPL household size |
| `pregnancy.endDate` | date | medicaid `/members/*/daysSincePregnancy` (derived) | Date pregnancy ended; days computed by adapter |

### `veteranStatus`

| Field | Type | Maps to |
|---|---|---|
| `veteranStatus.isVeteran` | boolean | `/members/*/isVeteran`, medicaid `/members/*/veteran` |
| `veteranStatus.hasDisability` | boolean | `/members/*/isVeteranWithDisability` |
| `veteranStatus.needsAidAndAttendance` | boolean | `/members/*/isVeteranNeedingAidAndAttendance` |
| `veteranStatus.survivorNeedsAidAndAttendance` | boolean | `/members/*/isVeteranSurvivorNeedingAidAndAttendance` |
| `veteranStatus.survivorHasDisability` | boolean | `/members/*/isVeteranSurvivorWithDisability` |

### `studentStatus`

| Field | Type | Maps to |
|---|---|---|
| `studentStatus.enrollment` | enum `[full_time, half_time, less_than_half_time_or_not_enrolled]` | `/members/*/studentEnrollmentStatus`; `full_time` also feeds medicaid `/members/*/isFullTimeStudent` |
| `studentStatus.inK12` | boolean | `/members/*/isInK12` |
| `studentStatus.inWorkStudy` | boolean | `/members/*/isParticipatingInWorkStudy` |
| `studentStatus.assignedByEmploymentTrainingProgram` | boolean | `/members/*/isAssignedToHigherEducationThroughEmploymentTrainingProgram` |
| `studentStatus.unfitForEmployment` | boolean | `/members/*/isPhysicallyOrMentallyUnfitForEmploymentForStudentEligibility` |

### `disabilityDetails` (refines the existing `isDisabled`)

| Field | Type | Maps to |
|---|---|---|
| `disabilityDetails.types` | array of enum `[physical, mental]` | `/members/*/hasPhysicalDisability`, `/hasMentalDisability` |
| `disabilityDetails.isIncapacitated` | boolean | `/members/*/isIncapacitated` |
| `disabilityDetails.unableToPrepareMeals` | boolean | `/members/*/isUnableToPurchaseAndPrepareOwnMealsDueToDisability` |
| `disabilityDetails.receivesDisabilityBenefits` | boolean | `/members/*/receivesTemporaryOrPermanentDisabilityBenefits` |
| `disabilityDetails.receivesPublicDisabilityPension` | boolean | `/members/*/receivesPublicDisabilityRetirementPension` |
| `disabilityDetails.receivesRailroadRetirementDisability` | boolean | `/members/*/receivesRailroadRetirementDisability` |
| `disabilityDetails.receivesInterimAssistance` | boolean | `/members/*/receivesInterimAssistanceForDisability` |
| `disabilityDetails.ssiApplicationPending` | boolean | `/members/*/isApplyingForOrAppealingSsiBenefits` |
| `disabilityDetails.inVocationalRehabilitation` | boolean | `/members/*/isParticipatingInVocationalRehabilitation` |
| `disabilityDetails.hasDisabledChild` | boolean | medicaid `/members/*/hasDisabledChild` |

When only the existing coarse `isDisabled: true` is supplied, the adapter maps
it to a physical disability and notes the assumption — or (stricter) treats
the split as missing. **Open question for review.**

### `livingSituation`

Multi-valued — several can hold at once:

| Field | Type | Maps to |
|---|---|---|
| `livingSituation.settings` | array of enum `[boarding_house, institution, federally_subsidized_elderly_housing, substance_abuse_treatment_facility, homeless_shelter, group_living_arrangement, battered_persons_shelter]` | `livesInBoardingHouse`, `livesInInstitution`, `livesInFederallySubsidizedElderlyHousing`, `residesAtSubstanceAbuseTreatmentFacility`, `livesInHomelessShelter`, `livesInGroupLivingArrangement`, `isResidentOfBatteredWomensShelter` |
| `livingSituation.isExperiencingHomelessness` | boolean | `/members/*/isExperiencingHomelessness` |
| `livingSituation.isBoarder` / `.isRoomer` | boolean | `isBoarder`, `isRoomer` |
| `livingSituation.isLiveInAttendant` | boolean | `isLiveInAttendant` |
| `livingSituation.isSeparateAndApart` | boolean | `isSeparateAndApart` |
| `livingSituation.preparesFoodWithHousehold` | boolean | `preparesFoodWithHousehold` |
| `livingSituation.recentlyReleasedFromInstitution` | boolean | `recentlyReleasedFromInstitution` |
| `livingSituation.participatesInAnotherHousehold` | boolean | `isParticipatingInAnotherHousehold` |

### `workRequirements`

| Field | Type | Maps to |
|---|---|---|
| `workRequirements.registeredForWork` | boolean | `registeredForWork` |
| `workRequirements.providedEmploymentInfo` | boolean | `providedEmploymentStatusOrAvailabilityInfo` |
| `workRequirements.reportedToReferredEmployer` | boolean | `reportedToReferredSuitableEmployer` |
| `workRequirements.inEmploymentTrainingProgram` | boolean | `isEnrolledInEmploymentTrainingProgram` |
| `workRequirements.appliedForOrReceivingUnemployment` | boolean | `isApplyingForOrReceivingUnemploymentInsuranceBenefits` |
| `workRequirements.inDrugOrAlcoholTreatment` | boolean | `isRegularParticipantInDrugOrAlcoholTreatment` |
| `workRequirements.complyingWithOtherWorkProgram` | boolean | `isComplyingWithColoradoWorksOrRefugeeServicesWorkProgram` |
| `workRequirements.abawdWaiverExempt` | boolean | `isExemptUnderAbawdWaiver` |
| `workRequirements.abawdStateExemption` | boolean | `isExemptUnderColoradoAbawdStateExemption` |
| `workRequirements.abawdWorkProgramHoursPerWeek` | number | `abawdWorkProgramHoursPerWeek` |
| `workRequirements.participatesInWorkfare` | boolean | `participatesInColoradoWorkfare` |
| `workRequirements.abawdCountableMonthsUsed` | integer | `countableMonths` |
| `workRequirements.unableToMaintainEmployment` | boolean | `isUnableToMaintainEmployment` |
| `workRequirements.impactedByDomesticViolence` | boolean | `isImpactedByDomesticViolence` |
| `workRequirements.temporaryConditionPreventsWork` | boolean | `hasSelfDeclaredTemporaryConditionPreventingWorkActivities` |
| `workRequirements.otherUnfitnessReason` | boolean | `hasOtherValidReasonForWorkRequirementsUnfitness` |
| `workRequirements.isMigrantFarmWorker` | boolean | `isMigrantFarmWorker` (also `household.isMigrantOrSeasonalFarmWorker` exists at coarse level) |
| `workRequirements.striker.isStriker` | boolean | `isStriker` |
| `workRequirements.striker.eligibleDayBeforeStrike` | boolean | `wasEligibleForSnapDayBeforeStrike` |
| `workRequirements.striker.exemptFromRegistrationDayBeforeStrike` | boolean | `wasExemptFromWorkRegistrationDayBeforeStrike` |

### `immigrationDetails` (extends the existing `immigrationStatus`)

| Field | Type | Maps to |
|---|---|---|
| `immigrationDetails.qualifiedYearsInUs` | integer | `qualifiedYearsInUs` |
| `immigrationDetails.qualifyingWorkQuarters` | integer | `qualifyingWorkQuarters` |
| `immigrationDetails.lawfullyResidedSince1996Senior` | boolean | `wasBornOnOrBeforeAug221931AndLawfullyResidedAug221996` |
| `immigrationDetails.qualifyingMilitaryConnection` | boolean | `hasQualifyingMilitaryConnection` |
| `immigrationDetails.sponsor.memberId` | string | `sponsorId` (member reference) |
| `immigrationDetails.sponsor.isOrganization` | boolean | `isSponsoredByOrganization` |
| `immigrationDetails.sponsor.dependentCount` | integer | `sponsorAndSpouseDependentCount` |
| `immigrationDetails.sponsor.otherSponsoredNonCitizens` | integer | `sponsoredNonCitizenCountOutsideHousehold` |

The graph's citizenship enum is richer than ORCA's
(`iraqi_or_afghan_special_immigrant`, `american_indian_born_abroad`,
`hmong_or_highland_laotian_tribal_member`, …) — proposed as additions to the
shared `ImmigrationStatus` enum.

### Flat member additions

| Field | Type | Maps to |
|---|---|---|
| `receivesTanf` | boolean | `receivesTanf` |
| `spouseId` | string | `spouseId` (member reference) |
| `isEmancipated` | boolean | `isEmancipated` |
| `isFosterChild` | boolean | `isFosterChild` |
| `wasInFosterCareOn18thBirthday` | boolean | `wasInFosterCareOn18thBirthday` |
| `receivesFamilyPreservationServices` | boolean | `receivesFamilyPreservationServices` |

---

## 2. Caseworker findings (`members[i].findings`) — never defaulted

These are **verification outcomes**, not applicant attributes: they don't
exist until a caseworker (or a records check) produces them. They are the 🔎
bucket from the gap analysis. Without them the determination is `pending`
with each listed in `x-missingInformation` — the adapter will not assume
"not disqualified."

| Field | Type | Maps to |
|---|---|---|
| `findings.ipvDisqualification` | boolean | `disqualifiedForIPV` |
| `findings.snapDrugFelonyConviction` | boolean | `convictedOfDrugRelatedFelonyWithSnap` |
| `findings.ssnNonCompliance` | boolean | `failedToProvideOrObtainSSN` |
| `findings.workRequirementsNonCooperation` | boolean | `disqualifiedForWorkRequirementsCooperation` |
| `findings.voluntaryQuit` | boolean | `voluntarilyQuitOrReducedWorkEffort` |
| `findings.voluntaryQuitReason` | enum (16 values, e.g. `discrimination`, `unsuitable_employment`, `lack_of_adequate_child_care`, `household_emergency`, …) | `voluntaryQuitReason` |
| `findings.qualityAssuranceNonCooperation` | boolean | `disqualifiedForQualityAssuranceCooperation` |
| `findings.felonyNonCompliance` | boolean | `disqualifiedForFelonyNonCompliance` |
| `findings.paroleOrProbationViolation` | boolean | `disqualifiedForParoleOrProbationViolation` |
| `findings.isFleeingFelon` | boolean | `isFleeingFelon` |
| `findings.sanctionImposed` | boolean | `hasLevelSanctionImposed` |

**Open question for the Worker Portal team:** should these ride the existing
`verificationSummary` (whose entries track obligation *status*:
`pending | inconclusive | satisfied | waived | cannot_verify`) with a result
value added, or live as this separate `findings` object? The two are
complementary — `verificationSummary` says *whether* something was verified,
`findings` says *what was found* — but the contract should pick one home.

---

## 3. Financial collection additions

### `income[i]` (existing array, new optional fields)

| Field | Type | Maps to |
|---|---|---|
| `payDate` | date | `/incomes/*/targetPayDate` |
| `monthsIntended` | integer | `/incomes/*/intendedMonths` |
| `receivedBeforeSnapParticipation` | boolean | `receivedBeforeSnapParticipation` |
| `isWorkSupplementation` | boolean | `isWorkSupplementationOrWorkSupportPublicAssistancePortion` |
| `fromTerminatedSource` | boolean | `isFromTerminatedSourceForDestituteIncome` |
| `fromNewSource` | boolean | `isFromNewSourceForDestituteIncome` |
| `excludedIncomeType` | string (rules vocabulary, ~54 values) | `otherExcludedIncomeType` |

### `expenses[i]`

| Field | Type | Maps to |
|---|---|---|
| `detailType` | string (rules vocabulary, ~78 values, e.g. `heating_fuel`, `medicare_premium`) | `/expenses/*/type` (overrides the coarse `category` mapping) |
| `reimbursementAmount` | number | `reimbursementAmount` |
| `shouldAverage` | boolean | `shouldAverage` |
| `monthsIntended` | integer | `intendedMonths` |
| `forWorkTrainingOrEducation` | boolean | `isNecessaryDependentCareForWorkTrainingOrEducation` |
| `paidOutsideHousehold` | boolean | `isDirectMonetaryPaymentToAgencyOrPersonOutsideHousehold` |
| `forClaimableShelterResidence` | boolean | `isForClaimableShelterResidence` |
| `dependentCareMileage` | integer | `milesDrivenToDependentCareFacility` |
| `medicalMileage` | integer | `milesDrivenForMedicalTreatment` |
| `utilityDetails.separateHeatingCoolingCosts` | boolean | `incursOrAnticipatesSeparateHeatingCoolingCosts` |
| `utilityDetails.privateRentalBilledForHeatingCooling` | boolean | `privateRentalBilledForHeatingCooling` |
| `utilityDetails.sharedResidencePaysPortion` | boolean | `sharedResidencePaysHeatingCoolingPortion` |
| `utilityDetails.publicHousingExcessCosts` | boolean | `publicHousingResponsibleForExcessHeatingCoolingCosts` |

### `assets[i]`

| Field | Type | Maps to |
|---|---|---|
| `detailType` | string (rules vocabulary, ~65 values, e.g. `savings_account`, `roth_ira`, `burial_plot`) | `/resourceItems/*/type` (overrides coarse `type`) |
| `excludedResourceType` | string (rules vocabulary) | `otherExcludedResourceType` |

### `employment[i]`

| Field | Type | Maps to |
|---|---|---|
| `abawdWorkType` | enum `[compensated_work, in_kind_work, verified_unpaid_work, other]` | `/jobs/*/abawdWorkType` |
| `isAtFederalMinimumWage` | boolean | `isAtFederalMinimumWage` |
| `isOnTheJobTraining` | boolean | `isOnTheJobTraining` |
| `goodCause.*` | booleans (12) | the refusal/quit "good cause" condition flags (`wagesBelowApplicableMinimum`, `unreasonableDistance`, `dailyCommuteExceedsTwoHours`, `noTransportationForNonWalkingDistance`, `unreasonableHealthSafetyRisk`, `worksiteSubjectToStrikeOrLockout`, `requiresLaborOrganizationAction`, `pieceRateYieldBelowApplicableWage`, `memberPhysicallyOrMentallyUnfit`, `outsideMajorFieldDuringInitialThirtyDays`, `interferesWithReligiousObservance`, `offerAccepted`) |

---

## 4. Household-level additions

| Field | Type | Maps to |
|---|---|---|
| `household.expectsShelterCosts` | boolean | `/hasOrExpectsShelterCosts` |
| `household.previousSubstantialLotteryWinnings` | boolean | `/hadPreviousSubstantialLotteryOrGamblingWinnings` |
| `household.participatesInCommodityFoodProgram` | boolean | `/participatesInCommodityFoodDistributionProgram` |
| `household.receivesEnergyAssistance` | boolean | `/receivesLeapInLast12Months` (LEAP = CO's LIHEAP) |
| `household.receivedEmergencyBenefits` | boolean | `/hasEebtInLast12Months` |
| `caregiverRelationships[]` | array | `/caregiverRelationships` collection |
| — `.caregiverId` / `.dependentId` | string | member references |
| — `.isParent` | boolean | `isParent` |
| — `.isNonparentParentalControl` | boolean | `isNonparentParentalControl` |
| — `.providesMostOfCare` | boolean | `caregiverProvidesMoreThanHalfOfPhysicalCare` |
| — `.adequateChildcareUnavailable` | boolean | `adequateChildcareUnavailable` |
| — `.claimedForWorkExemption` | boolean | `claimedForWorkRequirementsCareExemption` |

---

## 5. `applicationContext` (case metadata — replaces the hardcoded dates)

Operational facts about the application, set by the integrating system, with
**documented absence semantics** (the one place "default" is legitimate):

| Field | Type | Maps to | When absent |
|---|---|---|---|
| `filingDate` | date | `/applicationFilingDate` | today |
| `benefitMonth` | date | `/benefitMonth` | current month |
| `certificationPeriodStartDate` | date | `/certificationPeriodStartDate` | `benefitMonth` |
| `isRecertification` | boolean | `/isApplicationForRecertification` | `false` (new application) |
| `receivedSnapInLast30Days` | boolean | `/receivedSnapInLast30Days` | **no default → pending** (case history the state system knows) |
| `normalIssuanceCycleDate` | date | `/normalIssuanceCycleDate` | derived from `benefitMonth` |
| `livesInApplicationCounty` | boolean | `/livesInApplicationCounty` | `true` |
| `hasNearbyCountyArrangement` | boolean | `/hasNearbyCountyArrangement` | `false` |
| `disasterDeclarationActive` | boolean | `/isPresidentiallyDeclaredDisasterOrEmergency` | `false` |
| `dSnapActive` | boolean | `/dSnapActive` | `false` |
| `temporaryEmergencyActive` | boolean | `/temporaryEmergencyActive` | `false` |
| `inadvertentHouseholdErrorClaim` | boolean | `/hasInadvertentHouseholdErrorClaimDueToEarnedIncomeCalculation` | `false` |

Program-state flags (`dSnapActive`, disaster declarations) default `false`
because they describe the *operating environment*, which the deploying state
controls and can set globally — not facts about the applicant.

---

## Summary of the policy per bucket

| Bucket | Behavior when absent |
|---|---|
| Derivable (age, monthly hours, SSI flag) | computed; noted only if lossy |
| Collection rows (income/expenses/assets/employment) | absence = none reported |
| `applicationContext` | documented operational semantics (mostly "as of today") |
| Member attributes (§1) | **pending** + `x-missingInformation` |
| Caseworker findings (§2) | **pending** + `x-missingInformation` |

## Open questions

1. `findings` object vs. extending `verificationSummary` with result values
   (Worker Portal team's call — it's their contract pattern).
2. Coarse `isDisabled: true` with no `disabilityDetails`: map to physical
   with a note, or treat the physical/mental split as missing?
3. `detailType` pass-through vocabularies: published where? (Proposal: a
   `GET /v1/eligibility/vocabularies` endpoint or a static doc generated
   from the ruleset.)
4. Which §1 fields the Worker Portal can realistically collect at intake vs.
   which should be allowed to stay `pending` into caseworker review — that
   ordering is a State workflow decision.
