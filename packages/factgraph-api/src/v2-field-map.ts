/**
 * The v2 request-field → rules-input mapping, as data.
 *
 * Single source of truth for two consumers:
 *  - scripts/generate-input-dictionary.ts joins this with the rulesets'
 *    own definitions (descriptions, enum options, policy citations) to
 *    produce docs/input-dictionary.md — so field semantics are authored
 *    once, by the rule authors, and flow into the API docs.
 *  - the future v2 translator implementation, for which this is the
 *    field-routing table.
 *
 * `snap` / `medicaid` give the graph input path(s) the field feeds in each
 * ruleset; a field's "consuming programs" are exactly the rulesets it maps
 * into. `kind`:
 *  - direct      value passes through (modulo enum-casing)
 *  - derived     adapter computes the graph value (note says how)
 *  - structural  identity/reference plumbing, not a fact value
 *  - compat      carried for contract compatibility; not consumed by the
 *                rules today (note says what to use instead)
 */

export type FieldMapping = {
  /** v2 request field, dotted; `[]` marks array nesting. */
  field: string
  snap?: string | string[]
  medicaid?: string | string[]
  kind: 'direct' | 'derived' | 'structural' | 'compat'
  note?: string
}

export type FieldGroup = { title: string; entries: FieldMapping[] }

const d = (
  field: string,
  snap?: string | string[],
  medicaid?: string | string[],
  note?: string
): FieldMapping => ({ field, snap, medicaid, kind: 'direct', note })

const dv = (
  field: string,
  snap: string | string[] | undefined,
  medicaid: string | string[] | undefined,
  note: string
): FieldMapping => ({ field, snap, medicaid, kind: 'derived', note })

export const FIELD_MAP: FieldGroup[] = [
  {
    title: 'Member — identity & demographics',
    entries: [
      { field: 'members[].id', kind: 'structural', note: 'Caller handle; echoed on member-scoped decisions. Collection rows are linked positionally inside the engine.' },
      dv('members[].dateOfBirth', '/members/*/age', '/members/*/age', 'Age in whole years computed from dateOfBirth as of the evaluation date.'),
      dv('members[].citizenshipStatus', '/members/*/citizenshipImmigrationStatus', '/members/*/immigrantStatus', 'Combined with immigrationStatus into each ruleset\'s citizenship/immigration enum.'),
      dv('members[].immigrationStatus', '/members/*/citizenshipImmigrationStatus', '/members/*/immigrantStatus', 'Present when citizenshipStatus is non_citizen; refines the mapped enum value.'),
      dv('members[].relationshipToHead', '/members/*/isHeadOfHousehold', undefined, 'head_of_household → true; other values → false.'),
      { field: 'members[].spouseId', snap: '/members/*/spouseId', kind: 'structural', note: 'Reference to another member id.' },
      dv('members[].isDisabled', '/members/*/hasPhysicalDisability', '/members/*/disabled', 'Coarse ORCA flag. Ambiguous across programs — prefer disabilityDetails, which decomposes it into the observable facts each program\'s definition derives from.'),
    ],
  },
  {
    title: 'Member — pregnancy',
    entries: [
      d('members[].pregnancy.isPregnant', '/members/*/isPregnant'),
      d('members[].pregnancy.expectedChildren', undefined, '/members/*/pregnant'),
      dv('members[].pregnancy.endDate', undefined, '/members/*/daysSincePregnancy', 'Days since pregnancy computed from endDate as of the evaluation date.'),
    ],
  },
  {
    title: 'Member — veteran status',
    entries: [
      d('members[].veteranStatus.isVeteran', '/members/*/isVeteran', '/members/*/veteran'),
      d('members[].veteranStatus.hasDisability', '/members/*/isVeteranWithDisability'),
      d('members[].veteranStatus.needsAidAndAttendance', '/members/*/isVeteranNeedingAidAndAttendance'),
      d('members[].veteranStatus.survivorNeedsAidAndAttendance', '/members/*/isVeteranSurvivorNeedingAidAndAttendance'),
      d('members[].veteranStatus.survivorHasDisability', '/members/*/isVeteranSurvivorWithDisability'),
    ],
  },
  {
    title: 'Member — student status',
    entries: [
      dv('members[].studentStatus.enrollment', '/members/*/studentEnrollmentStatus', '/members/*/isFullTimeStudent', 'snake_case of the rules enum; full_time also sets the medicaid full-time-student flag.'),
      d('members[].studentStatus.inK12', '/members/*/isInK12'),
      d('members[].studentStatus.inWorkStudy', '/members/*/isParticipatingInWorkStudy'),
      d('members[].studentStatus.assignedByEmploymentTrainingProgram', '/members/*/isAssignedToHigherEducationThroughEmploymentTrainingProgram'),
      d('members[].studentStatus.unfitForEmployment', '/members/*/isPhysicallyOrMentallyUnfitForEmploymentForStudentEligibility'),
    ],
  },
  {
    title: 'Member — disability details',
    entries: [
      dv('members[].disabilityDetails.types', ['/members/*/hasPhysicalDisability', '/members/*/hasMentalDisability'], undefined, "Array values map to the physical/mental flags ('physical' → hasPhysicalDisability, 'mental' → hasMentalDisability)."),
      d('members[].disabilityDetails.isIncapacitated', '/members/*/isIncapacitated'),
      d('members[].disabilityDetails.unableToPrepareMeals', '/members/*/isUnableToPurchaseAndPrepareOwnMealsDueToDisability'),
      d('members[].disabilityDetails.receivesDisabilityBenefits', '/members/*/receivesTemporaryOrPermanentDisabilityBenefits'),
      d('members[].disabilityDetails.receivesPublicDisabilityPension', '/members/*/receivesPublicDisabilityRetirementPension'),
      d('members[].disabilityDetails.receivesRailroadRetirementDisability', '/members/*/receivesRailroadRetirementDisability'),
      d('members[].disabilityDetails.receivesInterimAssistance', '/members/*/receivesInterimAssistanceForDisability'),
      d('members[].disabilityDetails.ssiApplicationPending', '/members/*/isApplyingForOrAppealingSsiBenefits'),
      d('members[].disabilityDetails.inVocationalRehabilitation', '/members/*/isParticipatingInVocationalRehabilitation'),
      d('members[].disabilityDetails.hasDisabledChild', undefined, '/members/*/hasDisabledChild'),
    ],
  },
  {
    title: 'Member — living situation',
    entries: [
      dv('members[].livingSituation.settings', ['/members/*/livesInBoardingHouse', '/members/*/livesInInstitution', '/members/*/livesInFederallySubsidizedElderlyHousing', '/members/*/residesAtSubstanceAbuseTreatmentFacility', '/members/*/livesInHomelessShelter', '/members/*/livesInGroupLivingArrangement', '/members/*/isResidentOfBatteredWomensShelter'], undefined, 'Each array value sets the corresponding flag; settings can co-occur.'),
      d('members[].livingSituation.isExperiencingHomelessness', '/members/*/isExperiencingHomelessness'),
      d('members[].livingSituation.isBoarder', '/members/*/isBoarder'),
      d('members[].livingSituation.isRoomer', '/members/*/isRoomer'),
      d('members[].livingSituation.isLiveInAttendant', '/members/*/isLiveInAttendant'),
      d('members[].livingSituation.isSeparateAndApart', '/members/*/isSeparateAndApart'),
      d('members[].livingSituation.preparesFoodWithHousehold', '/members/*/preparesFoodWithHousehold'),
      d('members[].livingSituation.recentlyReleasedFromInstitution', '/members/*/recentlyReleasedFromInstitution'),
      d('members[].livingSituation.participatesInAnotherHousehold', '/members/*/isParticipatingInAnotherHousehold'),
    ],
  },
  {
    title: 'Member — work requirements',
    entries: [
      d('members[].workRequirements.registeredForWork', '/members/*/registeredForWork'),
      d('members[].workRequirements.providedEmploymentInfo', '/members/*/providedEmploymentStatusOrAvailabilityInfo'),
      d('members[].workRequirements.reportedToReferredEmployer', '/members/*/reportedToReferredSuitableEmployer'),
      d('members[].workRequirements.inEmploymentTrainingProgram', '/members/*/isEnrolledInEmploymentTrainingProgram'),
      d('members[].workRequirements.appliedForOrReceivingUnemployment', '/members/*/isApplyingForOrReceivingUnemploymentInsuranceBenefits'),
      d('members[].workRequirements.inDrugOrAlcoholTreatment', '/members/*/isRegularParticipantInDrugOrAlcoholTreatment'),
      d('members[].workRequirements.complyingWithOtherWorkProgram', '/members/*/isComplyingWithColoradoWorksOrRefugeeServicesWorkProgram'),
      d('members[].workRequirements.abawdWaiverExempt', '/members/*/isExemptUnderAbawdWaiver'),
      d('members[].workRequirements.abawdStateExemption', '/members/*/isExemptUnderColoradoAbawdStateExemption'),
      d('members[].workRequirements.abawdWorkProgramHoursPerWeek', '/members/*/abawdWorkProgramHoursPerWeek'),
      d('members[].workRequirements.abawdCountableMonthsUsed', '/members/*/countableMonths'),
      d('members[].workRequirements.participatesInWorkfare', '/members/*/participatesInColoradoWorkfare'),
      d('members[].workRequirements.unableToMaintainEmployment', '/members/*/isUnableToMaintainEmployment'),
      d('members[].workRequirements.impactedByDomesticViolence', '/members/*/isImpactedByDomesticViolence'),
      d('members[].workRequirements.temporaryConditionPreventsWork', '/members/*/hasSelfDeclaredTemporaryConditionPreventingWorkActivities'),
      d('members[].workRequirements.otherUnfitnessReason', '/members/*/hasOtherValidReasonForWorkRequirementsUnfitness'),
      d('members[].workRequirements.isMigrantFarmWorker', '/members/*/isMigrantFarmWorker'),
      d('members[].workRequirements.striker.isStriker', '/members/*/isStriker'),
      d('members[].workRequirements.striker.eligibleDayBeforeStrike', '/members/*/wasEligibleForSnapDayBeforeStrike'),
      d('members[].workRequirements.striker.exemptFromRegistrationDayBeforeStrike', '/members/*/wasExemptFromWorkRegistrationDayBeforeStrike'),
    ],
  },
  {
    title: 'Member — immigration details',
    entries: [
      d('members[].immigrationDetails.qualifiedYearsInUs', '/members/*/qualifiedYearsInUs'),
      d('members[].immigrationDetails.qualifyingWorkQuarters', '/members/*/qualifyingWorkQuarters'),
      d('members[].immigrationDetails.lawfullyResidedSince1996Senior', '/members/*/wasBornOnOrBeforeAug221931AndLawfullyResidedAug221996'),
      d('members[].immigrationDetails.qualifyingMilitaryConnection', '/members/*/hasQualifyingMilitaryConnection'),
      { field: 'members[].immigrationDetails.sponsor.memberId', snap: '/members/*/sponsorId', kind: 'structural', note: 'Reference to another member id, when the sponsor is in the household.' },
      d('members[].immigrationDetails.sponsor.isOrganization', '/members/*/isSponsoredByOrganization'),
      d('members[].immigrationDetails.sponsor.dependentCount', '/members/*/sponsorAndSpouseDependentCount'),
      d('members[].immigrationDetails.sponsor.otherSponsoredNonCitizens', '/members/*/sponsoredNonCitizenCountOutsideHousehold'),
    ],
  },
  {
    title: 'Member — caseworker findings (never defaulted)',
    entries: [
      d('members[].findings.ipvDisqualification', '/members/*/disqualifiedForIPV'),
      d('members[].findings.snapDrugFelonyConviction', '/members/*/convictedOfDrugRelatedFelonyWithSnap'),
      d('members[].findings.ssnNonCompliance', '/members/*/failedToProvideOrObtainSSN'),
      d('members[].findings.workRequirementsNonCooperation', '/members/*/disqualifiedForWorkRequirementsCooperation'),
      d('members[].findings.voluntaryQuit', '/members/*/voluntarilyQuitOrReducedWorkEffort'),
      d('members[].findings.voluntaryQuitReason', '/members/*/voluntaryQuitReason'),
      d('members[].findings.qualityAssuranceNonCooperation', '/members/*/disqualifiedForQualityAssuranceCooperation'),
      d('members[].findings.felonyNonCompliance', '/members/*/disqualifiedForFelonyNonCompliance'),
      d('members[].findings.paroleOrProbationViolation', '/members/*/disqualifiedForParoleOrProbationViolation'),
      d('members[].findings.isFleeingFelon', '/members/*/isFleeingFelon'),
      d('members[].findings.sanctionImposed', '/members/*/hasLevelSanctionImposed'),
    ],
  },
  {
    title: 'Member — other',
    entries: [
      d('members[].receivesTanf', '/members/*/receivesTanf'),
      d('members[].isEmancipated', '/members/*/isEmancipated'),
      d('members[].isFosterChild', '/members/*/isFosterChild'),
      d('members[].wasInFosterCareOn18thBirthday', '/members/*/wasInFosterCareOn18thBirthday'),
      d('members[].receivesFamilyPreservationServices', '/members/*/receivesFamilyPreservationServices'),
    ],
  },
  {
    title: 'Income (members[].income[])',
    entries: [
      dv('members[].income[].type', '/incomes/*/type', ['/earnedIncome', '/unearnedIncome'], 'employed/self_employed → earned; unearned → unearned. Medicaid sums all members\' income to the household scalars, normalized to monthly.'),
      dv('members[].income[].unearnedType', '/incomes/*/type', '/members/*/receivesSsi', 'Refines the SNAP income-source enum; ssi_or_ssdi also sets the medicaid SSI flag (note: ORCA conflates SSI with SSDI).'),
      { field: 'members[].income[].incomeBasis', kind: 'compat', note: 'Carried for ORCA compatibility; the rules do not currently distinguish net vs gross at the income-row level.' },
      d('members[].income[].amount', '/incomes/*/amount', ['/earnedIncome', '/unearnedIncome']),
      d('members[].income[].frequency', '/incomes/*/frequency'),
      d('members[].income[].payDate', '/incomes/*/targetPayDate'),
      d('members[].income[].monthsIntended', '/incomes/*/intendedMonths'),
      d('members[].income[].receivedBeforeSnapParticipation', '/incomes/*/receivedBeforeSnapParticipation'),
      d('members[].income[].isWorkSupplementation', '/incomes/*/isWorkSupplementationOrWorkSupportPublicAssistancePortion'),
      d('members[].income[].fromTerminatedSource', '/incomes/*/isFromTerminatedSourceForDestituteIncome'),
      d('members[].income[].fromNewSource', '/incomes/*/isFromNewSourceForDestituteIncome'),
      d('members[].income[].excludedIncomeType', '/incomes/*/otherExcludedIncomeType'),
      d('members[].income[].needBasedNonprofitCashDonationQuarterlyExclusionUsed', '/incomes/*/needBasedNonprofitCashDonationQuarterlyExclusionUsed'),
      d('members[].income[].indianTrustRestrictedLandInterestAnnualExclusionUsed', '/incomes/*/indianTrustRestrictedLandInterestAnnualExclusionUsed'),
    ],
  },
  {
    title: 'Expenses (members[].expenses[])',
    entries: [
      dv('members[].expenses[].category', '/expenses/*/type', undefined, 'Coarse ORCA category mapped to a representative rules type; supply detailType for precision.'),
      d('members[].expenses[].detailType', '/expenses/*/type', undefined, 'snake_case of the rules expense-type vocabulary (see Vocabularies below); overrides category.'),
      d('members[].expenses[].amount', '/expenses/*/amount'),
      d('members[].expenses[].frequency', '/expenses/*/frequency'),
      d('members[].expenses[].reimbursementAmount', '/expenses/*/reimbursementAmount'),
      d('members[].expenses[].shouldAverage', '/expenses/*/shouldAverage'),
      d('members[].expenses[].monthsIntended', '/expenses/*/intendedMonths'),
      d('members[].expenses[].forWorkTrainingOrEducation', '/expenses/*/isNecessaryDependentCareForWorkTrainingOrEducation'),
      d('members[].expenses[].paidOutsideHousehold', '/expenses/*/isDirectMonetaryPaymentToAgencyOrPersonOutsideHousehold'),
      d('members[].expenses[].forClaimableShelterResidence', '/expenses/*/isForClaimableShelterResidence'),
      d('members[].expenses[].dependentCareMileage', '/expenses/*/milesDrivenToDependentCareFacility'),
      d('members[].expenses[].medicalMileage', '/expenses/*/milesDrivenForMedicalTreatment'),
      d('members[].expenses[].utilityDetails.separateHeatingCoolingCosts', '/expenses/*/incursOrAnticipatesSeparateHeatingCoolingCosts'),
      d('members[].expenses[].utilityDetails.privateRentalBilledForHeatingCooling', '/expenses/*/privateRentalBilledForHeatingCooling'),
      d('members[].expenses[].utilityDetails.sharedResidencePaysPortion', '/expenses/*/sharedResidencePaysHeatingCoolingPortion'),
      d('members[].expenses[].utilityDetails.publicHousingExcessCosts', '/expenses/*/publicHousingResponsibleForExcessHeatingCoolingCosts'),
    ],
  },
  {
    title: 'Assets (members[].assets[])',
    entries: [
      dv('members[].assets[].type', '/resourceItems/*/type', undefined, 'Coarse ORCA type mapped to a representative rules type; supply detailType for precision.'),
      d('members[].assets[].detailType', '/resourceItems/*/type', undefined, 'snake_case of the rules resource-type vocabulary (see Vocabularies below); overrides type.'),
      d('members[].assets[].value', '/resourceItems/*/value'),
      d('members[].assets[].excludedResourceType', '/resourceItems/*/otherExcludedResourceType'),
    ],
  },
  {
    title: 'Employment (members[].employment[])',
    entries: [
      dv('members[].employment[].status', '/jobs/*/isSelfEmployed', undefined, 'self_employed → true; other values → false.'),
      dv('members[].employment[].hoursPerWeek', '/jobs/*/hoursPerWeek', '/members/*/monthlyHoursWorked', 'Medicaid monthly hours = sum of hoursPerWeek × 52/12 across jobs.'),
      d('members[].employment[].abawdWorkType', '/jobs/*/abawdWorkType'),
      d('members[].employment[].isAtFederalMinimumWage', '/jobs/*/isAtFederalMinimumWage'),
      d('members[].employment[].isOnTheJobTraining', '/jobs/*/isOnTheJobTraining'),
      d('members[].employment[].goodCause.wagesBelowApplicableMinimum', '/jobs/*/wagesBelowApplicableMinimum'),
      d('members[].employment[].goodCause.pieceRateYieldBelowApplicableWage', '/jobs/*/pieceRateYieldBelowApplicableWage'),
      d('members[].employment[].goodCause.requiresLaborOrganizationAction', '/jobs/*/requiresLaborOrganizationAction'),
      d('members[].employment[].goodCause.worksiteSubjectToStrikeOrLockout', '/jobs/*/worksiteSubjectToStrikeOrLockout'),
      d('members[].employment[].goodCause.unreasonableHealthSafetyRisk', '/jobs/*/unreasonableHealthSafetyRisk'),
      d('members[].employment[].goodCause.physicallyOrMentallyUnfit', '/jobs/*/memberPhysicallyOrMentallyUnfit'),
      d('members[].employment[].goodCause.outsideMajorFieldDuringInitialThirtyDays', '/jobs/*/outsideMajorFieldDuringInitialThirtyDays'),
      d('members[].employment[].goodCause.unreasonableDistance', '/jobs/*/unreasonableDistance'),
      d('members[].employment[].goodCause.dailyCommuteExceedsTwoHours', '/jobs/*/dailyCommuteExceedsTwoHours'),
      d('members[].employment[].goodCause.noTransportationForNonWalkingDistance', '/jobs/*/noTransportationForNonWalkingDistance'),
      d('members[].employment[].goodCause.interferesWithReligiousObservance', '/jobs/*/interferesWithReligiousObservance'),
      d('members[].employment[].goodCause.offerAccepted', '/jobs/*/offerAccepted'),
    ],
  },
  {
    title: 'Household',
    entries: [
      dv('household.size', undefined, '/householdSize', 'Medicaid derives household size from the members list (+ expected children); SNAP composes its own household unit from member facts. Supplied size is used as a cross-check.'),
      { field: 'household.housingCosts', kind: 'compat', note: 'Coarse ORCA field; prefer per-member expenses[] with category housing, which is what the rules consume.' },
      { field: 'household.utilityCosts', kind: 'compat', note: 'Coarse ORCA field; prefer per-member expenses[] with category utilities / a utility detailType.' },
      dv('household.isMigrantOrSeasonalFarmWorker', '/members/*/isMigrantFarmWorker', undefined, 'Household-level ORCA flag; the rules evaluate migrant status per member — prefer workRequirements.isMigrantFarmWorker.'),
      d('household.expectsShelterCosts', '/hasOrExpectsShelterCosts'),
      d('household.previousSubstantialLotteryWinnings', '/hadPreviousSubstantialLotteryOrGamblingWinnings'),
      d('household.participatesInCommodityFoodProgram', '/participatesInCommodityFoodDistributionProgram'),
      d('household.receivesEnergyAssistance', '/receivesLeapInLast12Months'),
      d('household.receivedEmergencyBenefits', '/hasEebtInLast12Months'),
    ],
  },
  {
    title: 'Caregiver relationships (household.caregiverRelationships[])',
    entries: [
      { field: 'household.caregiverRelationships[].caregiverId', snap: '/caregiverRelationships/*/caregiverId', kind: 'structural', note: 'Reference to a member id.' },
      { field: 'household.caregiverRelationships[].dependentId', snap: '/caregiverRelationships/*/dependentId', kind: 'structural', note: 'Reference to a member id.' },
      d('household.caregiverRelationships[].isParent', '/caregiverRelationships/*/isParent'),
      d('household.caregiverRelationships[].isNonparentParentalControl', '/caregiverRelationships/*/isNonparentParentalControl'),
      d('household.caregiverRelationships[].providesMostOfCare', '/caregiverRelationships/*/caregiverProvidesMoreThanHalfOfPhysicalCare'),
      d('household.caregiverRelationships[].adequateChildcareUnavailable', '/caregiverRelationships/*/adequateChildcareUnavailable'),
      d('household.caregiverRelationships[].claimedForWorkExemption', '/caregiverRelationships/*/claimedForWorkRequirementsCareExemption'),
    ],
  },
  {
    title: 'Application context',
    entries: [
      d('applicationContext.filingDate', '/applicationFilingDate'),
      d('applicationContext.benefitMonth', '/benefitMonth'),
      d('applicationContext.certificationPeriodStartDate', '/certificationPeriodStartDate'),
      d('applicationContext.isRecertification', '/isApplicationForRecertification'),
      d('applicationContext.receivedSnapInLast30Days', '/receivedSnapInLast30Days'),
      d('applicationContext.normalIssuanceCycleDate', '/normalIssuanceCycleDate'),
      d('applicationContext.livesInApplicationCounty', '/livesInApplicationCounty'),
      d('applicationContext.hasNearbyCountyArrangement', '/hasNearbyCountyArrangement'),
      d('applicationContext.disasterDeclarationActive', '/isPresidentiallyDeclaredDisasterOrEmergency'),
      d('applicationContext.dSnapActive', '/dSnapActive'),
      d('applicationContext.temporaryEmergencyActive', '/temporaryEmergencyActive'),
      d('applicationContext.inadvertentHouseholdErrorClaim', '/hasInadvertentHouseholdErrorClaimDueToEarnedIncomeCalculation'),
    ],
  },
]


// ---------------------------------------------------------------------------
// Realistic-source classification
// ---------------------------------------------------------------------------
//
// Per the State's guidance, the worker-portal contract should carry only the
// data that would realistically travel between the portal and the rules
// engine. The operational test: can the applicant self-attest it on an
// application form ('applicant'), does it come from state systems — records
// checks, case history, batch/data-exchange ('state') — or could it arrive
// either way ('either')? These are OUR BEST GUESSES, structured for the
// Worker Portal team and the State to correct; the dictionary surfaces them
// per field and derives the candidate portal-contract additions from them.

export type FieldSource = 'applicant' | 'state' | 'either'

/** Default source per group; FIELD_SOURCE_OVERRIDES wins per field. */
export const GROUP_SOURCE_DEFAULTS: Record<string, FieldSource> = {
  'Member — identity & demographics': 'applicant',
  'Member — pregnancy': 'applicant',
  'Member — veteran status': 'applicant',
  'Member — student status': 'applicant',
  'Member — disability details': 'applicant',
  'Member — living situation': 'applicant',
  'Member — work requirements': 'applicant',
  'Member — immigration details': 'applicant',
  'Member — caseworker findings (never defaulted)': 'state',
  'Member — other': 'either',
  'Income (members[].income[])': 'applicant',
  'Expenses (members[].expenses[])': 'applicant',
  'Assets (members[].assets[])': 'applicant',
  'Employment (members[].employment[])': 'applicant',
  'Household': 'applicant',
  'Caregiver relationships (household.caregiverRelationships[])': 'applicant',
  'Application context': 'state',
}

export const FIELD_SOURCE_OVERRIDES: Record<string, FieldSource> = {
  // Work requirements: administrative/compliance statuses live in state
  // systems; circumstances are applicant-attestable.
  'members[].workRequirements.registeredForWork': 'state',
  'members[].workRequirements.providedEmploymentInfo': 'state',
  'members[].workRequirements.reportedToReferredEmployer': 'state',
  'members[].workRequirements.complyingWithOtherWorkProgram': 'state',
  'members[].workRequirements.abawdWaiverExempt': 'state',
  'members[].workRequirements.abawdStateExemption': 'state',
  'members[].workRequirements.abawdCountableMonthsUsed': 'state',
  'members[].workRequirements.participatesInWorkfare': 'state',
  'members[].workRequirements.inEmploymentTrainingProgram': 'either',
  'members[].workRequirements.appliedForOrReceivingUnemployment': 'either',
  // Immigration: work quarters are an SSA data-exchange product.
  'members[].immigrationDetails.qualifyingWorkQuarters': 'either',
  // Member — other.
  'members[].isEmancipated': 'applicant',
  // Income: participation/case-history flags are state-side.
  'members[].income[].receivedBeforeSnapParticipation': 'state',
  'members[].income[].isWorkSupplementation': 'state',
  'members[].income[].excludedIncomeType': 'either',
  'members[].income[].needBasedNonprofitCashDonationQuarterlyExclusionUsed': 'state',
  'members[].income[].indianTrustRestrictedLandInterestAnnualExclusionUsed': 'state',
  // Assets / employment refinements.
  'members[].assets[].excludedResourceType': 'either',
  'members[].employment[].abawdWorkType': 'either',
  // Household: program-participation history is state-side.
  'household.previousSubstantialLotteryWinnings': 'either',
  'household.participatesInCommodityFoodProgram': 'either',
  'household.receivesEnergyAssistance': 'state',
  'household.receivedEmergencyBenefits': 'state',
  // Application context: the portal knows when it submitted.
  'applicationContext.filingDate': 'either',
}

/** v2 fields that already exist in the published worker-portal contract
 *  (so they are not "candidate additions"). */
export const PUBLISHED_CONTRACT_FIELDS = new Set([
  'members[].dateOfBirth',
  'members[].citizenshipStatus',
  'members[].immigrationStatus',
  'members[].relationshipToHead',
  'members[].isDisabled',
  'members[].income[].type',
  'members[].income[].unearnedType',
  'members[].income[].incomeBasis',
  'members[].income[].amount',
  'members[].income[].frequency',
  'members[].expenses[].category',
  'members[].expenses[].amount',
  'members[].expenses[].frequency',
  'members[].assets[].type',
  'members[].assets[].value',
  'members[].employment[].status',
  'members[].employment[].hoursPerWeek',
  'household.size',
  'household.housingCosts',
  'household.utilityCosts',
  'household.isMigrantOrSeasonalFarmWorker',
])

export function sourceOf(groupTitle: string, field: string): FieldSource | undefined {
  return FIELD_SOURCE_OVERRIDES[field] ?? GROUP_SOURCE_DEFAULTS[groupTitle]
}

/** The enum-bearing inputs whose value vocabularies the dictionary publishes
 *  in full (the contract carries them as open strings via detailType etc.). */
export const VOCABULARIES: Array<{ title: string; ruleset: string; path: string; apiField: string }> = [
  { title: 'Expense detail types', ruleset: 'snap-complete', path: '/expenses/*/type', apiField: 'members[].expenses[].detailType' },
  { title: 'Resource (asset) detail types', ruleset: 'snap-complete', path: '/resourceItems/*/type', apiField: 'members[].assets[].detailType' },
  { title: 'Income source types', ruleset: 'snap-complete', path: '/incomes/*/type', apiField: 'members[].income[].unearnedType (refines)' },
  { title: 'Excluded income types', ruleset: 'snap-complete', path: '/incomes/*/otherExcludedIncomeType', apiField: 'members[].income[].excludedIncomeType' },
  { title: 'Excluded resource types', ruleset: 'snap-complete', path: '/resourceItems/*/otherExcludedResourceType', apiField: 'members[].assets[].excludedResourceType' },
]
