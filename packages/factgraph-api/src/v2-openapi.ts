/**
 * v2 DRAFT PROPOSAL — Eligibility Adapter API.
 *
 * This document is a proposed revision of the blueprint eligibility-adapter
 * contract, offered for review alongside the conformant v1 implementation
 * (`consumer-openapi.ts`). v1 stays frozen as the contract-as-published;
 * this spec is what we believe the contract needs to produce correct,
 * no-guess determinations. Rationale lives in
 * docs/contract-gap-analysis.md and docs/request-field-proposal.md.
 *
 * What changes from v1 / the published contract:
 *  1. NO-GUESS POLICY. Applicant-material facts and caseworker findings are
 *     never defaulted. Anything needed-but-absent → `status: pending` with
 *     the fields listed in `missingInformation` (first-class, per-member).
 *     Derivations and documented absence semantics are spelled out per field.
 *  2. The request can actually CARRY a determination's inputs: ~70
 *     domain-shaped member/household/application fields (pregnancy,
 *     veteranStatus, studentStatus, disabilityDetails, livingSituation,
 *     workRequirements, immigrationDetails, findings, financial extensions,
 *     caregiverRelationships, applicationContext).
 *  3. Medicaid cardinality fixed: determination takes the household and
 *     returns one decision per member (or one member's decision via
 *     `subjectMemberId`) — MAGI eligibility depends on household size+income.
 *  4. Response can express the outcome: `benefitAmount` /
 *     `proratedFirstMonthAmount` first-class (an approval without an amount
 *     isn't actionable), `explanation` (path-free "why"), `translationNotes`.
 *  5. Explicit states: `status` adds `not_supported`; `path` adds
 *     `ex_parte` (the published contract's own example uses it but its enum
 *     omits it).
 *  6. Medicaid ex parte fully specified: household context on the call,
 *     conclusiveness-gate semantics, and PROPOSED serviceResult payload
 *     schemas for the FDSH services (the upstream schemas are currently
 *     empty stubs).
 *
 * Like v1, this contract is path-free: no Fact Graph paths, targets, or
 * traces anywhere.
 */
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

extendZodWithOpenApi(z)

export const V2_API_VERSION = '2.0.0-draft.1'

// ---------------------------------------------------------------------------
// Enum vocabularies (snake_case values per Worker Portal conventions)
// ---------------------------------------------------------------------------

const PROGRAM = ['snap', 'medicaid', 'chip', 'tanf', 'ccdf'] as const
const STATUS = ['pending', 'approved', 'denied', 'ineligible', 'not_supported'] as const
const PATH = ['auto', 'manual', 'ex_parte'] as const

const CITIZENSHIP = ['us_citizen', 'us_national', 'non_citizen'] as const
const IMMIGRATION = [
  'lawful_permanent_resident', 'refugee', 'asylee', 'deportation_withheld',
  'parolee', 'conditional_entrant', 'cuban_haitian_entrant', 'amerasian',
  'battered_non_citizen', 'trafficking_victim', 'temporary_protected_status',
  // proposed additions (present in the SNAP rules vocabulary, absent from ORCA)
  'iraqi_or_afghan_special_immigrant', 'american_indian_born_abroad',
  'hmong_or_highland_laotian_tribal_member',
  'other',
] as const
const RELATIONSHIP = [
  'head_of_household', 'spouse', 'partner', 'child', 'parent', 'sibling',
  'grandparent', 'grandchild', 'other_relative', 'non_relative',
] as const
const INCOME_TYPE = ['employed', 'self_employed', 'unearned'] as const
const INCOME_BASIS = ['net', 'gross'] as const
const FREQUENCY = [
  'hourly', 'daily', 'weekly', 'every_2_weeks', 'twice_a_month', 'monthly', 'yearly',
] as const
const EXPENSE_CATEGORY = [
  'housing', 'utilities', 'childcare', 'medical', 'dependent_care',
  'child_support_paid', 'other',
] as const
const ASSET_TYPE = [
  'liquid', 'vehicle', 'real_property', 'retirement_account', 'life_insurance', 'other',
] as const
const EMPLOYMENT_STATUS = ['full_time', 'part_time', 'seasonal', 'self_employed', 'not_employed'] as const

const ENROLLMENT = ['full_time', 'half_time', 'less_than_half_time_or_not_enrolled'] as const
const LIVING_SETTING = [
  'boarding_house', 'institution', 'federally_subsidized_elderly_housing',
  'substance_abuse_treatment_facility', 'homeless_shelter',
  'group_living_arrangement', 'battered_persons_shelter',
] as const
const ABAWD_WORK_TYPE = ['compensated_work', 'in_kind_work', 'verified_unpaid_work', 'other'] as const
const QUIT_REASON = [
  'discrimination', 'unreasonable_work_conditions', 'new_employment_or_schooling',
  'household_move_for_job_or_schooling', 'recognized_retirement_under_sixty',
  'unsuitable_employment', 'accepted_full_time_employment_did_not_materialize',
  'patterns_of_employment', 'illness_of_head_of_household',
  'illness_of_other_household_member', 'household_emergency',
  'unavailable_transportation', 'employer_demands_reduction',
  'lack_of_adequate_child_care', 'striking_government_employee', 'other',
] as const
const SERVICE_TYPE = [
  'fdsh_ssa', 'fdsh_vlp', 'fdsh_fti', 'fdsh_medicare', 'fdsh_vci',
  'ssa_ievs', 'irs_ievs', 'swica', 'uib', 'save',
  'enrollment_check', 'incarceration_check',
] as const
const CHECK_RESULT = ['conclusive', 'inconclusive', 'partial', 'error'] as const
const VERIFICATION_STATUS = ['pending', 'inconclusive', 'satisfied', 'waived', 'cannot_verify'] as const

// ---------------------------------------------------------------------------
// Representative example (full request — also documents "everything the
// determination can use")
// ---------------------------------------------------------------------------

const DETERMINATION_EXAMPLE = {
  metadata: { intake: { applicationId: 'app-123' }, eligibility: { caseId: 'case-456' } },
  program: 'snap',
  applicationContext: {
    filingDate: '2026-06-01',
    benefitMonth: '2026-06-01',
    isRecertification: false,
    receivedSnapInLast30Days: false,
  },
  household: {
    size: 2,
    housingCosts: 800,
    utilityCosts: 150,
    expectsShelterCosts: true,
    caregiverRelationships: [
      { caregiverId: 'head', dependentId: 'child', isParent: true, providesMostOfCare: true },
    ],
  },
  members: [
    {
      id: 'head',
      dateOfBirth: '1990-03-15',
      citizenshipStatus: 'us_citizen',
      relationshipToHead: 'head_of_household',
      isDisabled: false,
      pregnancy: { isPregnant: false },
      veteranStatus: { isVeteran: false },
      studentStatus: { enrollment: 'less_than_half_time_or_not_enrolled' },
      livingSituation: { preparesFoodWithHousehold: true, isExperiencingHomelessness: false },
      workRequirements: { registeredForWork: true, abawdCountableMonthsUsed: 0 },
      findings: { ipvDisqualification: false, isFleeingFelon: false },
      receivesTanf: false,
      income: [{ type: 'employed', amount: 1200, frequency: 'monthly', incomeBasis: 'gross' }],
      employment: [{ status: 'part_time', hoursPerWeek: 30, abawdWorkType: 'compensated_work' }],
      expenses: [{ category: 'housing', amount: 800, frequency: 'monthly', forClaimableShelterResidence: true }],
      assets: [{ type: 'liquid', detailType: 'checking_account', value: 500 }],
    },
    {
      id: 'child',
      dateOfBirth: '2020-01-01',
      citizenshipStatus: 'us_citizen',
      relationshipToHead: 'child',
      studentStatus: { inK12: false },
    },
  ],
  verificationSummary: [],
}

const MEDICAID_EXAMPLE = {
  metadata: { intake: { applicationId: 'app-789' }, eligibility: { caseId: 'case-1011' } },
  program: 'medicaid',
  household: { size: 3 },
  members: [
    {
      id: 'mom',
      dateOfBirth: '1992-04-10',
      citizenshipStatus: 'us_citizen',
      relationshipToHead: 'head_of_household',
      pregnancy: { isPregnant: true, expectedChildren: 1 },
      income: [{ type: 'employed', amount: 1800, frequency: 'monthly', incomeBasis: 'gross' }],
      employment: [{ status: 'full_time', hoursPerWeek: 40 }],
    },
    { id: 'baby', dateOfBirth: '2025-09-01', citizenshipStatus: 'us_citizen', relationshipToHead: 'child' },
    {
      id: 'gran',
      dateOfBirth: '1952-07-22',
      citizenshipStatus: 'non_citizen',
      immigrationStatus: 'lawful_permanent_resident',
      relationshipToHead: 'parent',
      income: [{ type: 'unearned', unearnedType: 'ssi_or_ssdi', amount: 900, frequency: 'monthly' }],
    },
  ],
  verificationSummary: [],
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export function buildV2OpenApiDocument() {
  const registry = new OpenAPIRegistry()

  // ---- member sub-objects -------------------------------------------------

  const Pregnancy = registry.register(
    'Pregnancy',
    z.object({
      isPregnant: z.boolean().optional(),
      expectedChildren: z.number().int().optional().openapi({
        description: 'Children expected from the current pregnancy; adds to household size for FPL.',
      }),
      endDate: z.string().optional().openapi({
        format: 'date',
        description: 'Date a recent pregnancy ended; drives postpartum coverage windows.',
      }),
    }).openapi({ description: 'Pregnancy status. Programs: SNAP, Medicaid. Absent fields are unknown (never guessed) and may produce `pending`.' })
  )

  const VeteranStatus = registry.register(
    'VeteranStatus',
    z.object({
      isVeteran: z.boolean().optional(),
      hasDisability: z.boolean().optional(),
      needsAidAndAttendance: z.boolean().optional(),
      survivorNeedsAidAndAttendance: z.boolean().optional(),
      survivorHasDisability: z.boolean().optional(),
    }).openapi({ description: 'Veteran status and related disability/survivor flags. Programs: SNAP, Medicaid.' })
  )

  const StudentStatus = registry.register(
    'StudentStatus',
    z.object({
      enrollment: z.enum(ENROLLMENT).optional(),
      inK12: z.boolean().optional(),
      inWorkStudy: z.boolean().optional(),
      assignedByEmploymentTrainingProgram: z.boolean().optional(),
      unfitForEmployment: z.boolean().optional(),
    }).openapi({ description: 'Student enrollment status and student-eligibility exemption flags. Programs: SNAP, Medicaid.' })
  )

  const DisabilityDetails = registry.register(
    'DisabilityDetails',
    z.object({
      types: z.array(z.enum(['physical', 'mental'])).optional(),
      isIncapacitated: z.boolean().optional(),
      unableToPrepareMeals: z.boolean().optional(),
      receivesDisabilityBenefits: z.boolean().optional(),
      receivesPublicDisabilityPension: z.boolean().optional(),
      receivesRailroadRetirementDisability: z.boolean().optional(),
      receivesInterimAssistance: z.boolean().optional(),
      ssiApplicationPending: z.boolean().optional(),
      inVocationalRehabilitation: z.boolean().optional(),
      hasDisabledChild: z.boolean().optional(),
    }).openapi({ description: 'Refines the coarse `isDisabled` with the distinctions program rules require — isDisabled alone is ambiguous (SNAP and Medicaid use different legal definitions of disability; both derive from these facts). Programs: SNAP, Medicaid.' })
  )

  const LivingSituation = registry.register(
    'LivingSituation',
    z.object({
      settings: z.array(z.enum(LIVING_SETTING)).optional().openapi({
        description: 'Living settings that currently apply (several can co-occur).',
      }),
      isExperiencingHomelessness: z.boolean().optional(),
      isBoarder: z.boolean().optional(),
      isRoomer: z.boolean().optional(),
      isLiveInAttendant: z.boolean().optional(),
      isSeparateAndApart: z.boolean().optional(),
      preparesFoodWithHousehold: z.boolean().optional(),
      recentlyReleasedFromInstitution: z.boolean().optional(),
      participatesInAnotherHousehold: z.boolean().optional(),
    }).openapi({ description: 'Living arrangement facts that drive household-composition rules (SNAP composes its household unit from these — e.g. preparesFoodWithHousehold). Programs: SNAP.' })
  )

  const StrikerStatus = registry.register(
    'StrikerStatus',
    z.object({
      isStriker: z.boolean().optional(),
      eligibleDayBeforeStrike: z.boolean().optional(),
      exemptFromRegistrationDayBeforeStrike: z.boolean().optional(),
    }).openapi({ description: 'Labor-dispute status.' })
  )

  const WorkRequirements = registry.register(
    'WorkRequirements',
    z.object({
      registeredForWork: z.boolean().optional(),
      providedEmploymentInfo: z.boolean().optional(),
      reportedToReferredEmployer: z.boolean().optional(),
      inEmploymentTrainingProgram: z.boolean().optional(),
      appliedForOrReceivingUnemployment: z.boolean().optional(),
      inDrugOrAlcoholTreatment: z.boolean().optional(),
      complyingWithOtherWorkProgram: z.boolean().optional(),
      abawdWaiverExempt: z.boolean().optional(),
      abawdStateExemption: z.boolean().optional(),
      abawdWorkProgramHoursPerWeek: z.number().optional(),
      abawdCountableMonthsUsed: z.number().int().optional(),
      participatesInWorkfare: z.boolean().optional(),
      unableToMaintainEmployment: z.boolean().optional(),
      impactedByDomesticViolence: z.boolean().optional(),
      temporaryConditionPreventsWork: z.boolean().optional(),
      otherUnfitnessReason: z.boolean().optional(),
      isMigrantFarmWorker: z.boolean().optional(),
      striker: StrikerStatus.optional(),
    }).openapi({ description: 'Work registration, ABAWD, and work-requirement exemption facts. Programs: SNAP.' })
  )

  const SponsorInfo = registry.register(
    'SponsorInfo',
    z.object({
      memberId: z.string().optional().openapi({ description: 'Sponsor, when a household member.' }),
      isOrganization: z.boolean().optional(),
      dependentCount: z.number().int().optional(),
      otherSponsoredNonCitizens: z.number().int().optional(),
    }).openapi({ description: 'Sponsor details for sponsored non-citizens (deeming rules).' })
  )

  const ImmigrationDetails = registry.register(
    'ImmigrationDetails',
    z.object({
      qualifiedYearsInUs: z.number().int().optional(),
      qualifyingWorkQuarters: z.number().int().optional(),
      lawfullyResidedSince1996Senior: z.boolean().optional(),
      qualifyingMilitaryConnection: z.boolean().optional(),
      sponsor: SponsorInfo.optional(),
    }).openapi({ description: 'Immigration detail beyond status — waiting-period and deeming inputs. Programs: SNAP.' })
  )

  const Findings = registry.register(
    'Findings',
    z.object({
      ipvDisqualification: z.boolean().optional(),
      snapDrugFelonyConviction: z.boolean().optional(),
      ssnNonCompliance: z.boolean().optional(),
      workRequirementsNonCooperation: z.boolean().optional(),
      voluntaryQuit: z.boolean().optional(),
      voluntaryQuitReason: z.enum(QUIT_REASON).optional(),
      qualityAssuranceNonCooperation: z.boolean().optional(),
      felonyNonCompliance: z.boolean().optional(),
      paroleOrProbationViolation: z.boolean().optional(),
      isFleeingFelon: z.boolean().optional(),
      sanctionImposed: z.boolean().optional(),
    }).openapi({
      description:
        'Caseworker/records-check verification OUTCOMES — these do not exist until verified and are never defaulted. A determination that needs one that is absent returns `pending` with the field in `missingInformation`. (Open question: these could alternatively ride `verificationSummary` with result values.) Programs: SNAP.',
    })
  )

  // ---- financial collections ----------------------------------------------

  const Income = registry.register(
    'Income',
    z.object({
      type: z.enum(INCOME_TYPE),
      unearnedType: z.string().optional(),
      incomeBasis: z.enum(INCOME_BASIS).optional().openapi({
        description:
          'Carried from the published contract for compatibility; not consumed by the rules today.',
      }),
      amount: z.number(),
      frequency: z.enum(FREQUENCY),
      payDate: z.string().optional().openapi({ format: 'date' }),
      monthsIntended: z.number().int().optional(),
      receivedBeforeSnapParticipation: z.boolean().optional(),
      isWorkSupplementation: z.boolean().optional(),
      fromTerminatedSource: z.boolean().optional().openapi({ description: 'Destitute-household income rules.' }),
      fromNewSource: z.boolean().optional(),
      excludedIncomeType: z.string().optional().openapi({
        description: 'Specific excluded-income category from the rules vocabulary, when applicable.',
      }),
      needBasedNonprofitCashDonationQuarterlyExclusionUsed: z.number().optional().openapi({
        description: 'Exclusion amount already used this quarter for need-based nonprofit cash donations (case history).',
      }),
      indianTrustRestrictedLandInterestAnnualExclusionUsed: z.number().optional().openapi({
        description: 'Exclusion amount already used this year for Indian trust / restricted-land interest income (case history).',
      }),
    }).openapi({ description: 'One income source. Absence of income rows means "no income reported" (documented semantics, not a guess).' })
  )

  const UtilityDetails = registry.register(
    'UtilityDetails',
    z.object({
      separateHeatingCoolingCosts: z.boolean().optional(),
      privateRentalBilledForHeatingCooling: z.boolean().optional(),
      sharedResidencePaysPortion: z.boolean().optional(),
      publicHousingExcessCosts: z.boolean().optional(),
    }).openapi({ description: 'Heating/cooling cost attribution — drives the utility allowance.' })
  )

  const Expense = registry.register(
    'Expense',
    z.object({
      category: z.enum(EXPENSE_CATEGORY),
      detailType: z.string().optional().openapi({
        description: 'Finer-grained expense type from the rules vocabulary (e.g. heating_fuel, medicare_premium); overrides the coarse category mapping.',
      }),
      amount: z.number(),
      frequency: z.enum(FREQUENCY),
      reimbursementAmount: z.number().optional(),
      shouldAverage: z.boolean().optional(),
      monthsIntended: z.number().int().optional(),
      forWorkTrainingOrEducation: z.boolean().optional(),
      paidOutsideHousehold: z.boolean().optional(),
      forClaimableShelterResidence: z.boolean().optional(),
      dependentCareMileage: z.number().int().optional(),
      medicalMileage: z.number().int().optional(),
      utilityDetails: UtilityDetails.optional(),
    }).openapi({ description: 'One expense.' })
  )

  const Asset = registry.register(
    'Asset',
    z.object({
      type: z.enum(ASSET_TYPE),
      detailType: z.string().optional().openapi({
        description: 'Finer-grained resource type from the rules vocabulary (e.g. checking_account, roth_ira, burial_plot).',
      }),
      value: z.number(),
      excludedResourceType: z.string().optional(),
      description: z.string().optional(),
    }).openapi({ description: 'One asset/resource.' })
  )

  const GoodCause = registry.register(
    'GoodCause',
    z.object({
      wagesBelowApplicableMinimum: z.boolean().optional(),
      pieceRateYieldBelowApplicableWage: z.boolean().optional(),
      requiresLaborOrganizationAction: z.boolean().optional(),
      worksiteSubjectToStrikeOrLockout: z.boolean().optional(),
      unreasonableHealthSafetyRisk: z.boolean().optional(),
      physicallyOrMentallyUnfit: z.boolean().optional(),
      outsideMajorFieldDuringInitialThirtyDays: z.boolean().optional(),
      unreasonableDistance: z.boolean().optional(),
      dailyCommuteExceedsTwoHours: z.boolean().optional(),
      noTransportationForNonWalkingDistance: z.boolean().optional(),
      interferesWithReligiousObservance: z.boolean().optional(),
      offerAccepted: z.boolean().optional(),
    }).openapi({ description: '"Good cause" job-refusal/quit conditions for work requirements.' })
  )

  const Employment = registry.register(
    'Employment',
    z.object({
      status: z.enum(EMPLOYMENT_STATUS).optional(),
      hoursPerWeek: z.number().optional(),
      abawdWorkType: z.enum(ABAWD_WORK_TYPE).optional(),
      isAtFederalMinimumWage: z.boolean().optional(),
      isOnTheJobTraining: z.boolean().optional(),
      goodCause: GoodCause.optional(),
    }).openapi({ description: 'One job, with the work-requirement detail SNAP needs.' })
  )

  // ---- member / household / application -----------------------------------

  const MemberContext = registry.register(
    'MemberContext',
    z.object({
      id: z.string().openapi({ description: "Caller's stable handle; echoed on per-member results." }),
      dateOfBirth: z.string().openapi({ format: 'date' }),
      citizenshipStatus: z.enum(CITIZENSHIP).optional(),
      immigrationStatus: z.enum(IMMIGRATION).optional(),
      immigrationDetails: ImmigrationDetails.optional(),
      relationshipToHead: z.enum(RELATIONSHIP).optional(),
      spouseId: z.string().optional(),
      isDisabled: z.boolean().optional().openapi({
        description:
          'PROPOSED FOR CONSOLIDATION into `disabilityDetails`. A single boolean is ambiguous across programs — SNAP and Medicaid apply different legal definitions of disability — so we propose carrying the observable facts each definition derives from instead. Still accepted (and mapped coarsely, with the assumption disclosed) for callers sending the published-contract shape.',
        'x-supersededBy': 'disabilityDetails',
      }),
      disabilityDetails: DisabilityDetails.optional(),
      pregnancy: Pregnancy.optional(),
      veteranStatus: VeteranStatus.optional(),
      studentStatus: StudentStatus.optional(),
      livingSituation: LivingSituation.optional(),
      workRequirements: WorkRequirements.optional(),
      findings: Findings.optional(),
      receivesTanf: z.boolean().optional(),
      isEmancipated: z.boolean().optional(),
      isFosterChild: z.boolean().optional(),
      wasInFosterCareOn18thBirthday: z.boolean().optional(),
      receivesFamilyPreservationServices: z.boolean().optional(),
      programs: z.array(z.enum(PROGRAM)).optional(),
      income: z.array(Income).optional(),
      expenses: z.array(Expense).optional(),
      assets: z.array(Asset).optional(),
      employment: z.array(Employment).optional(),
    }).openapi({
      description:
        'A household member. Only `id` and `dateOfBirth` are required. Every other field is optional — but under the no-guess policy, absent applicant-material facts are UNKNOWN, not defaulted: if the determination needs one, the response is `pending` with the field in `missingInformation`.',
    })
  )

  const CaregiverRelationship = registry.register(
    'CaregiverRelationship',
    z.object({
      caregiverId: z.string(),
      dependentId: z.string(),
      isParent: z.boolean().optional(),
      isNonparentParentalControl: z.boolean().optional(),
      providesMostOfCare: z.boolean().optional(),
      adequateChildcareUnavailable: z.boolean().optional(),
      claimedForWorkExemption: z.boolean().optional(),
    }).openapi({ description: 'A caregiver→dependent relationship (work-requirement exemptions). Programs: SNAP.' })
  )

  const Household = registry.register(
    'Household',
    z.object({
      size: z.number().int().optional(),
      housingCosts: z.number().optional().openapi({
        description:
          'PROPOSED FOR CONSOLIDATION into per-member `expenses[]` (category housing), which is what the rules consume. Still accepted — when sent without a covering expense, the adapter applies it as a monthly housing expense.',
        'x-supersededBy': 'members[].expenses[] (category housing)',
      }),
      utilityCosts: z.number().optional().openapi({
        description:
          'PROPOSED FOR CONSOLIDATION into per-member `expenses[]` (category utilities / a utility detailType). Still accepted.',
        'x-supersededBy': 'members[].expenses[] (category utilities)',
      }),
      isMigrantOrSeasonalFarmWorker: z.boolean().optional().openapi({
        description:
          'PROPOSED FOR CONSOLIDATION into `workRequirements.isMigrantFarmWorker` — the rules evaluate migrant/seasonal status per member. Still accepted.',
        'x-supersededBy': 'members[].workRequirements.isMigrantFarmWorker',
      }),
      expectsShelterCosts: z.boolean().optional(),
      previousSubstantialLotteryWinnings: z.boolean().optional(),
      participatesInCommodityFoodProgram: z.boolean().optional(),
      receivesEnergyAssistance: z.boolean().optional(),
      receivedEmergencyBenefits: z.boolean().optional(),
      caregiverRelationships: z.array(CaregiverRelationship).optional(),
    }).openapi({ description: 'Household-level data.' })
  )

  const ApplicationContext = registry.register(
    'ApplicationContext',
    z.object({
      filingDate: z.string().optional().openapi({ format: 'date', description: 'Absent: today.' }),
      benefitMonth: z.string().optional().openapi({ format: 'date', description: 'Absent: current month.' }),
      certificationPeriodStartDate: z.string().optional().openapi({ format: 'date', description: 'Absent: benefitMonth.' }),
      isRecertification: z.boolean().optional().openapi({ description: 'Absent: false (new application).' }),
      receivedSnapInLast30Days: z.boolean().optional().openapi({ description: 'Absent: unknown → pending (case history the state system knows).' }),
      normalIssuanceCycleDate: z.string().optional().openapi({ format: 'date' }),
      livesInApplicationCounty: z.boolean().optional().openapi({ description: 'Absent: true.' }),
      hasNearbyCountyArrangement: z.boolean().optional(),
      disasterDeclarationActive: z.boolean().optional().openapi({ description: 'Operating-environment flag; absent: false.' }),
      dSnapActive: z.boolean().optional(),
      temporaryEmergencyActive: z.boolean().optional(),
      inadvertentHouseholdErrorClaim: z.boolean().optional(),
    }).openapi({
      description:
        'Case metadata set by the integrating system — the one place absence has DOCUMENTED default semantics ("evaluate as of now, new application, normal operating conditions") rather than producing pending.',
    })
  )

  const metadata = z.record(z.string(), z.unknown()).openapi({
    description: 'Opaque correlation context, echoed back unchanged; never inspected.',
  })

  const VerificationSummaryEntry = registry.register(
    'VerificationSummaryEntry',
    z.object({
      memberId: z.string().optional(),
      type: z.string().optional().openapi({ description: 'The verification obligation this entry tracks.' }),
      status: z.enum(VERIFICATION_STATUS),
    }).openapi({ description: 'Status of one verification obligation.' })
  )

  const DeterminationRequest = registry.register(
    'DeterminationRequest',
    z.object({
      metadata: metadata,
      program: z.enum(PROGRAM),
      applicationContext: ApplicationContext.optional(),
      household: Household,
      members: z.array(MemberContext).min(1),
      subjectMemberId: z.string().optional().openapi({
        description:
          'Per-member programs (medicaid): return only this member\'s decision, computed against the full household. Omit to receive every member\'s decision.',
      }),
      verificationSummary: z.array(VerificationSummaryEntry).optional(),
    }).openapi({
      description:
        'Determination request. ALWAYS household-shaped — per-member programs still require household context (MAGI eligibility depends on household size + income).',
      example: DETERMINATION_EXAMPLE as never,
    })
  )

  // ---- responses ------------------------------------------------------------

  const MissingInformation = registry.register(
    'MissingInformation',
    z.object({
      field: z.string().openapi({ description: 'Domain field still needed (never an engine-internal path).' }),
      memberId: z.string().optional().openapi({ description: 'Present when the field is member-scoped.' }),
      dataType: z.string(),
      options: z.array(z.string()).optional(),
    }).openapi({ description: 'One piece of information still needed to reach a determination.' })
  )

  const ExplanationStep = registry.register(
    'ExplanationStep',
    z.object({
      factor: z.string(),
      outcome: z.unknown(),
    }).openapi({ description: 'One step of the domain-summarized "why" behind an outcome.' })
  )

  const Decision = registry.register(
    'Decision',
    z.object({
      scope: z.enum(['household', 'member']).openapi({
        description:
          'What this decision applies to. Household-unit programs (SNAP) emit one household-scoped decision; per-member programs (medicaid/chip) emit one member-scoped decision per member. The scope is a property of the program rules, not the request.',
      }),
      memberId: z.string().optional().openapi({
        description: 'Present iff scope is member.',
      }),
      status: z.enum(STATUS).openapi({
        description:
          'approved · denied (failed a test; appeal rights) · ineligible (categorical bar) · pending (information missing — see missingInformation) · not_supported (program recognized but not implemented by this adapter).',
      }),
      path: z.enum(PATH).openapi({
        description: 'auto — rules engine; manual — caseworker; ex_parte — determined from already-available information.',
      }),
      denialReasonCode: z.string().optional().openapi({ example: 'failed_gross_income_test' }),
      benefitAmount: z.number().optional().openapi({
        description: 'Monthly benefit when status is approved, for benefit-amount programs (SNAP allotment).',
      }),
      proratedFirstMonthAmount: z.number().optional(),
      medicaidCategory: z.string().optional().openapi({
        description: 'Medicaid only: Infant | YoungChild | OlderChild | Adult | Pregnant | SsiRecipient | Ineligible.',
      }),
      chpEligible: z.boolean().optional().openapi({ description: 'Medicaid only: CHP+ alternative eligibility.' }),
      explanation: z.array(ExplanationStep).optional(),
    }).openapi({
      description:
        'One eligibility decision. A single schema covers every program — what varies is the scope and which outcome fields apply (documented per field). Program-specific values never change the shape.',
    })
  )

  const DeterminationResponse = registry.register(
    'DeterminationResponse',
    z.object({
      metadata: metadata,
      program: z.enum(PROGRAM),
      decisions: z.array(Decision).openapi({
        description:
          'The decisions this evaluation produced: exactly one household-scoped entry for household-unit programs (SNAP); one member-scoped entry per member for per-member programs (medicaid) — or a single entry when subjectMemberId was supplied.',
      }),
      missingInformation: z.array(MissingInformation).optional().openapi({
        description: 'Present when any decision is pending — exactly what is still needed. The progressive-disclosure loop: supply these and re-call.',
      }),
      translationNotes: z.array(z.string()).optional().openapi({
        description: 'Lossy derivations the determination relied on (e.g. SSI inferred from a conflated SSI/SSDI income type). Under the no-guess policy, nothing here is a guessed fact.',
      }),
    }).openapi({
      description:
        'The one determination response shape for every program. Callers never branch on program to know the schema; they iterate decisions[].',
    })
  )

  const ExpeditedScreeningRequest = registry.register(
    'ExpeditedScreeningRequest',
    z.object({
      metadata: metadata,
      applicationContext: ApplicationContext.optional(),
      household: Household,
      members: z.array(MemberContext).min(1),
    }).openapi({ description: 'Expedited SNAP screening (7 CFR §273.2(i)). Member/resource context is required — first-class here, not an overlay.' })
  )

  const ExpeditedScreeningResponse = registry.register(
    'ExpeditedScreeningResponse',
    z.object({
      metadata: metadata,
      expedited: z.boolean(),
      missingInformation: z.array(MissingInformation).optional(),
    }).openapi({ description: 'Expedited screening result.' })
  )

  // ---- ex parte -------------------------------------------------------------

  const FdshFtiResult = registry.register(
    'FdshFtiResult',
    z.object({
      taxYear: z.number().int().optional(),
      filingStatus: z.string().optional(),
      householdSize: z.number().int().optional().openapi({ description: 'Tax-unit size (MAGI household ≈ tax unit).' }),
      earnedIncomeMonthly: z.number().optional(),
      unearnedIncomeMonthly: z.number().optional(),
    }).openapi({
      description:
        'PROPOSED shape — the upstream serviceResult schema for fdsh_fti is currently an empty stub. Offered as a starting point for the data-exchange contract discussion.',
    })
  )

  const FdshSsaResult = registry.register(
    'FdshSsaResult',
    z.object({
      ssiRecipient: z.boolean().optional(),
      ssdiRecipient: z.boolean().optional(),
      monthlyBenefitAmount: z.number().optional(),
    }).openapi({ description: 'PROPOSED shape — upstream schema is currently an empty stub.' })
  )

  const ElectronicCheckResult = registry.register(
    'ElectronicCheckResult',
    z.object({
      serviceType: z.enum(SERVICE_TYPE),
      result: z.enum(CHECK_RESULT),
      receivedAt: z.string().optional().openapi({ format: 'date-time' }),
      serviceResult: z.record(z.string(), z.unknown()).optional().openapi({
        description:
          'Service-specific payload. Polymorphic on serviceType — see FdshFtiResult / FdshSsaResult for the proposed shapes this adapter would consume.',
      }),
    }).openapi({ description: 'Outcome of one data-exchange service call.' })
  )

  const MedicaidExParteRequest = registry.register(
    'MedicaidExParteRequest',
    z.object({
      metadata: metadata,
      program: z.literal('medicaid'),
      household: Household.openapi({
        description: 'REQUIRED here (a v2 change): MAGI eligibility needs household size + income even for a single applicant.',
      }),
      members: z.array(MemberContext).min(1),
      subjectMemberId: z.string().openapi({
        description: 'The applicant being evaluated ex parte.',
      }),
      electronicChecks: z.array(ElectronicCheckResult).min(1),
    }).openapi({
      description:
        'Ex parte evaluation (42 CFR §435.916): same MAGI determination, different evidentiary pathway. Semantics: every check relevant to a fact the determination depends on must be `conclusive`; otherwise the response is `pending` (the applicant cannot be asked for documentation on this pathway) and the case falls to the regular process.',
    })
  )

  const ProblemDetails = registry.register(
    'ProblemDetails',
    z.object({
      type: z.string(),
      title: z.string(),
      status: z.number().int(),
      detail: z.string(),
    }).openapi({ description: 'RFC 9457 Problem Details error.' })
  )

  const bearerAuth = registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http', scheme: 'bearer',
    description: 'Required on evaluate endpoints when a token is configured.',
  })

  // ---- paths ----------------------------------------------------------------

  const draftNote =
    ' **Draft proposal — not yet implemented.** The conformant v1 endpoint remains available under /v1/eligibility.'

  registry.registerPath({
    method: 'post',
    path: '/v2/eligibility/evaluate/determination',
    summary: 'Final eligibility determination (no-guess).',
    description:
      'Household-shaped for every program, and one response shape for every program: a DeterminationResponse whose decisions[] carry one household-scoped entry (SNAP) or one member-scoped entry per member (medicaid; or a single member via subjectMemberId). Nothing applicant-material is defaulted: anything needed-but-absent yields status pending + missingInformation.' +
      draftNote,
    tags: ['Eligibility v2 (draft)'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: DeterminationRequest,
            examples: {
              'snap-household': {
                summary: 'SNAP — working household of 2',
                value: DETERMINATION_EXAMPLE,
              },
              'medicaid-household': {
                summary: 'Medicaid — pregnant head, infant, LPR grandparent on SSI',
                value: MEDICAID_EXAMPLE,
              },
            },
          } as never,
        },
      },
    },
    responses: {
      200: {
        description: 'The unified DeterminationResponse — same schema for every program.',
        content: { 'application/json': { schema: DeterminationResponse } },
      },
      400: { description: 'Invalid request.', content: { 'application/json': { schema: ProblemDetails } } },
      401: { description: 'Authentication required.', content: { 'application/json': { schema: ProblemDetails } } },
      501: { description: 'Draft proposal — not yet implemented.', content: { 'application/json': { schema: ProblemDetails } } },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/v2/eligibility/evaluate/expedited-screening',
    summary: 'Expedited SNAP screening (7 CFR §273.2(i)).',
    description: 'Member/resource context first-class; missingInformation on the response when the screen cannot be decided.' + draftNote,
    tags: ['Eligibility v2 (draft)'],
    security: [{ [bearerAuth.name]: [] }],
    request: { body: { required: true, content: { 'application/json': { schema: ExpeditedScreeningRequest } } } },
    responses: {
      200: { description: 'Screening result.', content: { 'application/json': { schema: ExpeditedScreeningResponse } } },
      400: { description: 'Invalid request.', content: { 'application/json': { schema: ProblemDetails } } },
      401: { description: 'Authentication required.', content: { 'application/json': { schema: ProblemDetails } } },
      501: { description: 'Draft proposal — not yet implemented.', content: { 'application/json': { schema: ProblemDetails } } },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/v2/eligibility/evaluate/medicaid-ex-parte',
    summary: 'Medicaid ex parte evaluation.',
    description:
      'Same MAGI determination via the electronic-evidence pathway: household context required, every relevant check must be conclusive or the response is pending, and path is ex_parte (added to the DecisionPath enum — the published contract\'s example already uses it).' +
      draftNote,
    tags: ['Eligibility v2 (draft)'],
    security: [{ [bearerAuth.name]: [] }],
    request: { body: { required: true, content: { 'application/json': { schema: MedicaidExParteRequest } } } },
    responses: {
      200: { description: 'DeterminationResponse with one member-scoped decision for the subject applicant.', content: { 'application/json': { schema: DeterminationResponse } } },
      400: { description: 'Invalid request.', content: { 'application/json': { schema: ProblemDetails } } },
      401: { description: 'Authentication required.', content: { 'application/json': { schema: ProblemDetails } } },
      501: { description: 'Draft proposal — not yet implemented.', content: { 'application/json': { schema: ProblemDetails } } },
    },
  })

  const generator = new OpenApiGeneratorV31(registry.definitions)
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Eligibility Adapter API — v2 draft proposal',
      version: V2_API_VERSION,
      description: [
        '**Status: draft proposal for review — not an implemented surface.** The conformant v1 contract lives at `/v1/eligibility` and is unaffected.',
        '',
        'A proposed revision of the eligibility-adapter contract, addressing the gaps documented in `docs/contract-gap-analysis.md` and `docs/request-field-proposal.md`:',
        '',
        '1. **No-guess policy** — applicant-material facts and verification findings are never defaulted; what is missing comes back as `pending` + `missingInformation`.',
        '2. **The request can carry a real determination** — domain-shaped member, household, and application-context fields for everything the rules consume.',
        '3. **Medicaid cardinality fixed** — household in, per-member decisions out (or one member via `subjectMemberId`).',
        '4. **One response shape for every program** — a `DeterminationResponse` whose `decisions[]` entries carry a `scope` (`household` for SNAP, `member` for medicaid/chip). Callers never branch on program to know the schema.',
        '5. **The response can express the outcome** — `benefitAmount`, `missingInformation`, `explanation` as first-class fields; `status` adds `not_supported`; `path` adds `ex_parte`.',
        '6. **Ex parte fully specified** — including proposed serviceResult payload shapes where the upstream schemas are currently stubs.',
        '',
        'Like v1, this contract is path-free: no rules-engine internals anywhere.',
        '',
        '**Field semantics:** every request field is defined in the generated [input dictionary](https://github.com/Gary-Community-Ventures/rules-visualizer/blob/main/packages/factgraph-api/docs/input-dictionary.md) — rule-author-written definitions, full enum vocabularies (including the open-string `detailType` value sets), policy citations, and which programs consume each field. Group schemas carry a `Programs:` tag inline.',
      ].join('\n'),
      license: { name: 'MPL-2.0' },
    },
    servers: [
      { url: 'https://rules-visualizer-factgraph-api-f0c14673cf3a.herokuapp.com', description: 'Production (serves this spec; endpoints return 501 until the proposal is reviewed)' },
      { url: 'http://localhost:5002', description: 'Local dev' },
    ],
    tags: [{ name: 'Eligibility v2 (draft)', description: 'Proposed revision — for review, not yet implemented.' }],
  })
}
