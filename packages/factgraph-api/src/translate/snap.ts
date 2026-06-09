/**
 * SNAP translation layer — ORCA → Fact Graph and back.
 *
 * The partner team's eligibility adapter contract
 * (https://github.com/codeforamerica/safety-net-blueprint, file
 * `packages/contracts/eligibility-adapter-openapi.yaml`) defines a
 * domain-oriented request shape built from the ORCA ("Open Rules for
 * Client Applications") data model — `household`, `members[]` with nested
 * `income[]` / `expenses[]` / `assets[]`, and a `ProgramDecision`
 * response. The Worker Portal speaks that shape and treats the rules
 * engine as a black box; it must never see a Fact Graph path.
 *
 * This module is that black box's interior for SNAP. It owns:
 *   - the field-by-field map from ORCA concepts to `snap-complete`
 *     fact paths (the mapping originally written up in
 *     `docs/examples-snap.md`, now executable),
 *   - the defaulting policy for the ~80 per-member disqualifier flags the
 *     ORCA request doesn't carry (see DEFAULTING below), and
 *   - the `/eligibilityCategory` → `DecisionStatus` mapping that produces
 *     a `ProgramDecision`.
 *
 * DEFAULTING. `snap-complete` requires every per-member flag as a concrete
 * Boolean — it has no native "unknown". The ORCA request carries only a
 * handful of member attributes, so the rest are defaulted to the
 * "not disqualified / typical applicant" baseline below. A determination
 * computed this way is conditional on those defaults holding; we surface
 * the assumption in the response's `x-translationNotes` rather than hiding
 * it. See docs/examples-snap.md § "The fields the adapter request doesn't
 * carry" for the policy discussion.
 *
 * The baseline constants are lifted verbatim from the canonical working
 * scenario (`docs/bruno/12-snap-complete-eligible.bru`, itself drawn from
 * `data/factgraph/snap-complete/profiles.json`).
 */
import { z } from 'zod'

import type { QueryResponse } from '../evaluate.js'

export const SNAP_RULESET_ID = 'snap-complete'

/** Targets that build a SNAP ProgramDecision. */
export const SNAP_DETERMINATION_TARGETS = [
  '/isExpedited',
  '/eligibilityCategory',
  '/allotment',
  '/proratedAllotment',
] as const

/** Target for the standalone expedited-screening endpoint. */
export const SNAP_EXPEDITED_TARGET = '/isExpedited'

// ---------------------------------------------------------------------------
// ORCA request schemas (mirror the blueprint eligibility-adapter contract)
// ---------------------------------------------------------------------------
//
// Kept permissive (`.passthrough()`) on the nested objects: the contract
// is owned by the blueprint and may carry fields we don't map yet, and an
// adapter should tolerate forward-compatible additions rather than 400 on
// them. We validate only the fields this translation actually reads.

const OrcaIncome = z
  .object({
    type: z.string().optional(),
    unearnedType: z.string().optional(),
    amount: z.number(),
    frequency: z.string().optional(),
    incomeBasis: z.string().optional(),
  })
  .passthrough()

const OrcaExpense = z
  .object({
    category: z.string().optional(),
    amount: z.number(),
    frequency: z.string().optional(),
  })
  .passthrough()

const OrcaAsset = z
  .object({
    type: z.string().optional(),
    value: z.number(),
    description: z.string().optional(),
  })
  .passthrough()

export const MemberContextSchema = z
  .object({
    id: z.string().min(1),
    dateOfBirth: z.string().optional(),
    citizenshipStatus: z.string().optional(),
    immigrationStatus: z.string().optional(),
    relationshipToHead: z.string().optional(),
    isDisabled: z.boolean().optional(),
    programs: z.array(z.string()).optional(),
    income: z.array(OrcaIncome).optional(),
    expenses: z.array(OrcaExpense).optional(),
    assets: z.array(OrcaAsset).optional(),
  })
  .passthrough()

const HouseholdSchema = z.object({ size: z.number().optional() }).passthrough()

const MetadataSchema = z.record(z.string(), z.unknown()).optional()

export const HouseholdDeterminationRequestSchema = z
  .object({
    metadata: MetadataSchema,
    program: z.string(),
    household: HouseholdSchema,
    members: z.array(MemberContextSchema).min(1),
    verificationSummary: z.array(z.unknown()).optional(),
  })
  .passthrough()

export const ExpeditedScreeningRequestSchema = z
  .object({
    metadata: MetadataSchema,
    household: HouseholdSchema,
    // The base contract is household-only; the engine still needs member
    // and resource context to evaluate 7 CFR §273.2(i), so we accept the
    // same overlay the contract sanctions ("states may extend via overlay").
    members: z.array(MemberContextSchema).min(1),
  })
  .passthrough()

export type MemberContext = z.infer<typeof MemberContextSchema>
export type HouseholdDeterminationRequest = z.infer<
  typeof HouseholdDeterminationRequestSchema
>
export type ExpeditedScreeningRequest = z.infer<
  typeof ExpeditedScreeningRequestSchema
>

// ---------------------------------------------------------------------------
// Value maps (ORCA enum → Fact Graph enum). These are value translations,
// not display formatting — see CLAUDE.md.
// ---------------------------------------------------------------------------

const CITIZENSHIP_MAP: Record<string, string> = {
  us_citizen: 'Citizen',
}

const INCOME_TYPE_MAP: Record<string, string> = {
  employed: 'WagesAndSalaries',
}

const EXPENSE_TYPE_MAP: Record<string, string> = {
  housing: 'Rent',
  utilities: 'Electricity',
}

const ASSET_TYPE_MAP: Record<string, string> = {
  liquid: 'CheckingAccount',
}

const FREQUENCY_MAP: Record<string, string> = {
  monthly: 'Monthly',
  weekly: 'Weekly',
  biweekly: 'BiWeekly',
  semimonthly: 'SemiMonthly',
  annual: 'Annually',
  yearly: 'Annually',
}

// ---------------------------------------------------------------------------
// Baseline defaults (lifted from the canonical working scenario)
// ---------------------------------------------------------------------------

/** Administrative facts about the application itself — not about the
 *  applicant. The ORCA request doesn't carry these; a real integration
 *  would set them from the case record (see the `applicationContext`
 *  proposal in docs/request-field-proposal.md). Defaulted here to the
 *  "new application, normal operating conditions" baseline. */
const OPERATIONAL_SCALAR_DEFAULTS: Record<string, unknown> = {
  '/isApplicationForRecertification': false,
  '/receivedSnapInLast30Days': false,
  '/receivesLeapInLast12Months': false,
  '/dSnapActive': false,
  '/temporaryEmergencyActive': false,
  '/hasEebtInLast12Months': false,
  '/hasOrExpectsShelterCosts': true,
  '/hadPreviousSubstantialLotteryOrGamblingWinnings': false,
  '/participatesInCommodityFoodDistributionProgram': false,
  '/livesInApplicationCounty': true,
  '/hasNearbyCountyArrangement': false,
  '/isPresidentiallyDeclaredDisasterOrEmergency': false,
  '/hasInadvertentHouseholdErrorClaimDueToEarnedIncomeCalculation': false,
}

/** Format a Date as the engine's `yyyy-mm-dd` Day string (UTC). */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Application timing facts, derived from the evaluation date. Calling the
 *  endpoint means "evaluate this application as of now": filed today, for
 *  this benefit month, certification period starting with it. The issuance
 *  cycle date mirrors the canonical baseline's mid-month cycle. A real
 *  integration will override all of these via `applicationContext` once the
 *  request carries it (docs/request-field-proposal.md §5). */
function applicationTimingDefaults(asOf: Date): Record<string, unknown> {
  const monthStart = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1)
  )
  const midMonth = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 15)
  )
  return {
    '/applicationFilingDate': isoDay(asOf),
    '/benefitMonth': isoDay(monthStart),
    '/certificationPeriodStartDate': isoDay(monthStart),
    '/normalIssuanceCycleDate': isoDay(midMonth),
  }
}

/** Per-member flag baseline. Every `/members/*\/...` writable the ORCA
 *  request doesn't carry, defaulted to the "typical, non-disqualified"
 *  applicant. The four fields the ORCA member DOES map onto
 *  (age, citizenship, head-of-household, physical disability) are
 *  overwritten per member; the rest ride these defaults. */
const MEMBER_FLAG_DEFAULTS: Record<string, unknown> = {
  '/members/*/age': 35,
  '/members/*/hasPhysicalDisability': false,
  '/members/*/hasMentalDisability': false,
  '/members/*/isIncapacitated': false,
  '/members/*/isVeteranWithDisability': false,
  '/members/*/isVeteranNeedingAidAndAttendance': false,
  '/members/*/isVeteranSurvivorNeedingAidAndAttendance': false,
  '/members/*/isVeteranSurvivorWithDisability': false,
  '/members/*/receivesPublicDisabilityRetirementPension': false,
  '/members/*/receivesRailroadRetirementDisability': false,
  '/members/*/receivesInterimAssistanceForDisability': false,
  '/members/*/isBoarder': false,
  '/members/*/isRoomer': false,
  '/members/*/livesInBoardingHouse': false,
  '/members/*/livesInInstitution': false,
  '/members/*/livesInFederallySubsidizedElderlyHousing': false,
  '/members/*/residesAtSubstanceAbuseTreatmentFacility': false,
  '/members/*/livesInHomelessShelter': false,
  '/members/*/preparesFoodWithHousehold': true,
  '/members/*/livesInGroupLivingArrangement': false,
  '/members/*/isLiveInAttendant': false,
  '/members/*/isSeparateAndApart': false,
  '/members/*/isHeadOfHousehold': true,
  '/members/*/isEmancipated': false,
  '/members/*/isFosterChild': false,
  '/members/*/isUnableToPurchaseAndPrepareOwnMealsDueToDisability': false,
  '/members/*/isMigrantFarmWorker': false,
  '/members/*/receivesFamilyPreservationServices': false,
  '/members/*/countableMonths': 0,
  '/members/*/disqualifiedForIPV': false,
  '/members/*/convictedOfDrugRelatedFelonyWithSnap': false,
  '/members/*/failedToProvideOrObtainSSN': false,
  '/members/*/isParticipatingInWorkStudy': false,
  '/members/*/isAssignedToHigherEducationThroughEmploymentTrainingProgram': false,
  '/members/*/isInK12': false,
  '/members/*/disqualifiedForWorkRequirementsCooperation': false,
  '/members/*/voluntarilyQuitOrReducedWorkEffort': false,
  '/members/*/registeredForWork': true,
  '/members/*/providedEmploymentStatusOrAvailabilityInfo': true,
  '/members/*/reportedToReferredSuitableEmployer': true,
  '/members/*/isApplyingForOrReceivingUnemploymentInsuranceBenefits': false,
  '/members/*/isRegularParticipantInDrugOrAlcoholTreatment': false,
  '/members/*/isComplyingWithColoradoWorksOrRefugeeServicesWorkProgram': false,
  '/members/*/disqualifiedForQualityAssuranceCooperation': false,
  '/members/*/isPhysicallyOrMentallyUnfitForEmploymentForStudentEligibility': false,
  '/members/*/recentlyReleasedFromInstitution': false,
  '/members/*/hasSelfDeclaredTemporaryConditionPreventingWorkActivities': false,
  '/members/*/receivesTemporaryOrPermanentDisabilityBenefits': false,
  '/members/*/isParticipatingInVocationalRehabilitation': false,
  '/members/*/isApplyingForOrAppealingSsiBenefits': false,
  '/members/*/isUnableToMaintainEmployment': false,
  '/members/*/isImpactedByDomesticViolence': false,
  '/members/*/hasOtherValidReasonForWorkRequirementsUnfitness': false,
  '/members/*/isEnrolledInEmploymentTrainingProgram': false,
  '/members/*/isParticipatingInAnotherHousehold': false,
  '/members/*/isResidentOfBatteredWomensShelter': false,
  '/members/*/disqualifiedForFelonyNonCompliance': false,
  '/members/*/disqualifiedForParoleOrProbationViolation': false,
  '/members/*/isPregnant': false,
  '/members/*/isVeteran': false,
  '/members/*/wasInFosterCareOn18thBirthday': false,
  '/members/*/isExemptUnderAbawdWaiver': false,
  '/members/*/isExemptUnderColoradoAbawdStateExemption': false,
  '/members/*/abawdWorkProgramHoursPerWeek': 0,
  '/members/*/participatesInColoradoWorkfare': false,
  '/members/*/isExperiencingHomelessness': false,
  '/members/*/isFleeingFelon': false,
  '/members/*/isStriker': false,
  '/members/*/wasEligibleForSnapDayBeforeStrike': false,
  '/members/*/wasExemptFromWorkRegistrationDayBeforeStrike': false,
  '/members/*/studentEnrollmentStatus': 'LessThanHalfTimeOrNotEnrolled',
  '/members/*/citizenshipImmigrationStatus': 'Citizen',
  '/members/*/qualifiedYearsInUs': 0,
  '/members/*/qualifyingWorkQuarters': 0,
  '/members/*/wasBornOnOrBeforeAug221931AndLawfullyResidedAug221996': false,
  '/members/*/hasQualifyingMilitaryConnection': false,
  '/members/*/sponsorAndSpouseDependentCount': 0,
  '/members/*/sponsoredNonCitizenCountOutsideHousehold': 0,
  '/members/*/isSponsoredByOrganization': false,
  '/members/*/receivesTanf': false,
  '/members/*/hasLevelSanctionImposed': false,
}

/** A `/jobs` row default for earned income. snap-complete expects one per
 *  earned-income source to carry work-requirement data the ORCA request
 *  doesn't model. */
const JOB_ROW_DEFAULTS: Record<string, unknown> = {
  '/jobs/*/hoursPerWeek': 30,
  '/jobs/*/abawdWorkType': 'CompensatedWork',
  '/jobs/*/isSelfEmployed': false,
  '/jobs/*/isAtFederalMinimumWage': false,
  '/jobs/*/isOnTheJobTraining': false,
  '/jobs/*/offerAccepted': true,
  '/jobs/*/wagesBelowApplicableMinimum': false,
  '/jobs/*/pieceRateYieldBelowApplicableWage': false,
  '/jobs/*/requiresLaborOrganizationAction': false,
  '/jobs/*/worksiteSubjectToStrikeOrLockout': false,
  '/jobs/*/unreasonableHealthSafetyRisk': false,
  '/jobs/*/memberPhysicallyOrMentallyUnfit': false,
  '/jobs/*/outsideMajorFieldDuringInitialThirtyDays': false,
  '/jobs/*/unreasonableDistance': false,
  '/jobs/*/dailyCommuteExceedsTwoHours': false,
  '/jobs/*/noTransportationForNonWalkingDistance': false,
  '/jobs/*/interferesWithReligiousObservance': false,
}

const INCOME_ROW_DEFAULTS: Record<string, unknown> = {
  '/incomes/*/receivedBeforeSnapParticipation': false,
  '/incomes/*/isWorkSupplementationOrWorkSupportPublicAssistancePortion': false,
  '/incomes/*/isFromTerminatedSourceForDestituteIncome': false,
  '/incomes/*/isFromNewSourceForDestituteIncome': false,
}

const EXPENSE_ROW_DEFAULTS: Record<string, unknown> = {
  '/expenses/*/isForClaimableShelterResidence': true,
  '/expenses/*/isNecessaryDependentCareForWorkTrainingOrEducation': false,
  '/expenses/*/isDirectMonetaryPaymentToAgencyOrPersonOutsideHousehold': false,
  '/expenses/*/reimbursementAmount': 0,
  '/expenses/*/incursOrAnticipatesSeparateHeatingCoolingCosts': false,
  '/expenses/*/privateRentalBilledForHeatingCooling': false,
  '/expenses/*/sharedResidencePaysHeatingCoolingPortion': false,
  '/expenses/*/publicHousingResponsibleForExcessHeatingCoolingCosts': false,
  '/expenses/*/shouldAverage': false,
}

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

export type TranslationNote = string

export type TranslatedQuery = {
  inputs: Record<string, unknown>
  /** Assumptions made while filling fields the ORCA request didn't carry,
   *  or values that fell through a value map to a default. Surfaced on the
   *  response so the caller can see what the determination is conditional
   *  on. */
  notes: TranslationNote[]
}

/** Map a value through a lookup table, recording a note when it falls
 *  through to the default. */
function mapValue(
  raw: string | undefined,
  table: Record<string, string>,
  fallback: string,
  notes: TranslationNote[],
  label: string
): string {
  if (raw == null) return fallback
  const mapped = table[raw]
  if (mapped !== undefined) return mapped
  notes.push(
    `${label}: no mapping for "${raw}" — defaulted to "${fallback}". ` +
      `Add a mapping if this value should drive the determination differently.`
  )
  return fallback
}

/** Whole-years age from an ISO date of birth, as of `asOf`. */
function ageFromDob(dob: string, asOf: Date): number | undefined {
  const born = new Date(dob)
  if (Number.isNaN(born.getTime())) return undefined
  let age = asOf.getUTCFullYear() - born.getUTCFullYear()
  const beforeBirthday =
    asOf.getUTCMonth() < born.getUTCMonth() ||
    (asOf.getUTCMonth() === born.getUTCMonth() &&
      asOf.getUTCDate() < born.getUTCDate())
  if (beforeBirthday) age -= 1
  return age
}

/**
 * Translate an ORCA household request into the unified `inputs` map for a
 * `snap-complete` query. The nested per-member `income[]` / `expenses[]` /
 * `assets[]` arrays fan out into the separate top-level `/incomes`,
 * `/jobs`, `/expenses`, `/resourceItems` collections the ruleset expects,
 * each row carrying a `/<collection>/*\/memberId` cross-reference back to
 * the member's `id`.
 */
export function translateHouseholdRequest(
  req: { members: MemberContext[] },
  asOf: Date
): TranslatedQuery {
  const notes: TranslationNote[] = []

  const members: Array<Record<string, unknown>> = []
  const incomes: Array<Record<string, unknown>> = []
  const jobs: Array<Record<string, unknown>> = []
  const expenses: Array<Record<string, unknown>> = []
  const resourceItems: Array<Record<string, unknown>> = []

  for (const [memberIdx, m] of req.members.entries()) {
    // Collection rows cross-reference their member by POSITION (`#N`), not
    // by the row's `id` string. The Fact Graph engine resolves the `#N`
    // form against the member's index in `/members`; the id-string form is
    // not resolved, so an income tagged with `memberId: "head"` ends up
    // attributed to no member (its monthly amount computes to 0). We keep
    // the human `id` on each row for response correlation but link with
    // `#N`.
    const memberRef = `#${memberIdx}`
    const row: Record<string, unknown> = { id: m.id, ...MEMBER_FLAG_DEFAULTS }

    if (m.dateOfBirth) {
      const age = ageFromDob(m.dateOfBirth, asOf)
      if (age === undefined) {
        notes.push(
          `member ${m.id}: dateOfBirth "${m.dateOfBirth}" is not a valid date — kept default age ${MEMBER_FLAG_DEFAULTS['/members/*/age']}.`
        )
      } else {
        row['/members/*/age'] = age
      }
    }
    if (m.citizenshipStatus !== undefined) {
      row['/members/*/citizenshipImmigrationStatus'] = mapValue(
        m.citizenshipStatus,
        CITIZENSHIP_MAP,
        'Citizen',
        notes,
        `member ${m.id} citizenshipStatus`
      )
    }
    if (m.relationshipToHead !== undefined) {
      row['/members/*/isHeadOfHousehold'] =
        m.relationshipToHead === 'head_of_household'
    }
    if (m.isDisabled !== undefined) {
      row['/members/*/hasPhysicalDisability'] = m.isDisabled
    }
    members.push(row)

    for (const [i, inc] of (m.income ?? []).entries()) {
      const type = mapValue(
        inc.type,
        INCOME_TYPE_MAP,
        'WagesAndSalaries',
        notes,
        `member ${m.id} income[${i}].type`
      )
      incomes.push({
        id: `${m.id}-income-${i}`,
        '/incomes/*/memberId': memberRef,
        '/incomes/*/type': type,
        '/incomes/*/amount': inc.amount,
        '/incomes/*/frequency': mapValue(
          inc.frequency,
          FREQUENCY_MAP,
          'Monthly',
          notes,
          `member ${m.id} income[${i}].frequency`
        ),
        ...INCOME_ROW_DEFAULTS,
      })
      // Earned income needs a sibling /jobs row for work-requirement data.
      if (type === 'WagesAndSalaries') {
        jobs.push({
          id: `${m.id}-job-${i}`,
          '/jobs/*/memberId': memberRef,
          ...JOB_ROW_DEFAULTS,
        })
      }
    }

    for (const [i, exp] of (m.expenses ?? []).entries()) {
      expenses.push({
        id: `${m.id}-expense-${i}`,
        '/expenses/*/memberId': memberRef,
        '/expenses/*/type': mapValue(
          exp.category,
          EXPENSE_TYPE_MAP,
          'Rent',
          notes,
          `member ${m.id} expenses[${i}].category`
        ),
        '/expenses/*/amount': exp.amount,
        '/expenses/*/frequency': mapValue(
          exp.frequency,
          FREQUENCY_MAP,
          'Monthly',
          notes,
          `member ${m.id} expenses[${i}].frequency`
        ),
        ...EXPENSE_ROW_DEFAULTS,
      })
    }

    for (const [i, asset] of (m.assets ?? []).entries()) {
      resourceItems.push({
        id: `${m.id}-asset-${i}`,
        '/resourceItems/*/memberId': memberRef,
        '/resourceItems/*/type': mapValue(
          asset.type,
          ASSET_TYPE_MAP,
          'CheckingAccount',
          notes,
          `member ${m.id} assets[${i}].type`
        ),
        '/resourceItems/*/value': asset.value,
      })
    }
  }

  if (notes.length > 0) {
    notes.unshift(
      'This determination defaults the per-member disqualifier flags the ' +
        'request does not carry to a non-disqualified baseline; it is ' +
        'conditional on those defaults. See docs/examples-snap.md.'
    )
  }

  const inputs: Record<string, unknown> = {
    ...OPERATIONAL_SCALAR_DEFAULTS,
    ...applicationTimingDefaults(asOf),
    '/members': members,
    '/incomes': incomes,
    '/jobs': jobs,
    '/expenses': expenses,
    '/resourceItems': resourceItems,
    '/caregiverRelationships': [],
  }

  return { inputs, notes }
}

// ---------------------------------------------------------------------------
// Response mapping — QueryResponse → ProgramDecision
// ---------------------------------------------------------------------------

export type DecisionStatus = 'pending' | 'approved' | 'denied' | 'ineligible'
export type DecisionPath = 'auto' | 'manual'

/** One still-needed input, path-free. The consumer contract must not expose
 *  Fact Graph paths (per the partner's requirement), so we surface the
 *  field's human display name + type rather than its `/members/*\/...` path.
 *  `field` is the rules display label today; the intent is to map these to
 *  ORCA field names as the contract firms up. */
export type MissingInformation = {
  field: string
  dataType: string
  options?: string[]
}

/** One step of a path-free, domain-summarized explanation: which factor drove
 *  the outcome and its value. Derived from the deciding chain with Fact Graph
 *  paths stripped — the domain-readable summary, not the raw trace (raw traces
 *  with paths live only on the advanced /query endpoint). */
export type ExplanationStep = {
  factor: string
  outcome: unknown
}

/** The blueprint's ProgramDecision plus `x-`-prefixed overlay extensions.
 *  The base fields (metadata, program, status, path, denialReasonCode) are
 *  the contract; everything `x-`-prefixed is our additive overlay, which
 *  the contract's `additionalProperties: true` sanctions. None of these
 *  expose Fact Graph paths. */
export type ProgramDecision = {
  metadata: Record<string, unknown>
  program: string
  status: DecisionStatus
  path: DecisionPath
  denialReasonCode?: string
  'x-allotment'?: number
  'x-proratedAllotment'?: number
  'x-expedited'?: boolean
  /** Present when status is `pending` — the information still needed to reach
   *  a determination, by field name (no Fact Graph paths). The
   *  progressive-disclosure hook the base contract lacks. */
  'x-missingInformation'?: MissingInformation[]
  /** Assumptions made by the translation layer (defaulted flags, unmapped
   *  enum values). */
  'x-translationNotes'?: string[]
  /** Domain-summarized "why", path-free. Present on denials. */
  'x-explanation'?: ExplanationStep[]
}

/** Map a deciding gate path to a stable, machine-readable denial code.
 *  Codes are snake_case per the Worker Portal conventions; the paths are
 *  internal to this mapping and never leave the adapter. The boolean marks
 *  whether the gate is a financial *test* (→ `denied`, appealable) vs a
 *  categorical bar (→ `ineligible`). */
const DENIAL_REASON_BY_GATE: Record<string, { code: string; categorical: boolean }> = {
  '/meetsGrossIncomeTest': { code: 'failed_gross_income_test', categorical: false },
  '/meetsNetIncomeTest': { code: 'failed_net_income_test', categorical: false },
  '/meetsResourceTest': { code: 'failed_resource_test', categorical: false },
  '/disqualifiedForBCE': { code: 'disqualified_broad_categorical', categorical: true },
  '/meetsNonFinancialCriteria': { code: 'failed_non_financial_criteria', categorical: true },
}

/** Resolve the deciding gate into { status, reasonCode }: `denied` for a
 *  failed financial test (appeal rights), `ineligible` for a categorical bar.
 *  Defaults to `denied` (most SNAP denials are income-based). */
function deriveDenial(query: QueryResponse): {
  status: 'denied' | 'ineligible'
  reasonCode: string
} {
  const chain = query.decidingPaths?.['/eligibilityCategory']
  if (Array.isArray(chain) && chain.length > 0) {
    const deciding = chain[chain.length - 1]
    const hit = DENIAL_REASON_BY_GATE[deciding?.path ?? '']
    if (hit) {
      return { status: hit.categorical ? 'ineligible' : 'denied', reasonCode: hit.code }
    }
  }
  return { status: 'denied', reasonCode: 'other' }
}

/** Convert the engine's path-bearing missingInputs into the path-free
 *  consumer shape (display name + type). Shared with the medicaid mapping. */
export function toMissingInformation(
  missing: QueryResponse['missingInputs']
): MissingInformation[] {
  return (missing ?? []).map((m) => {
    const info: MissingInformation = { field: m.name, dataType: m.dataType }
    if (m.enumOptions) info.options = m.enumOptions
    return info
  })
}

/** Build a path-free explanation from the deciding chain: keep only the
 *  named factors (skip anonymous/path-only nodes) so nothing leaks a path. */
function toExplanation(query: QueryResponse): ExplanationStep[] {
  const chain = query.decidingPaths?.['/eligibilityCategory']
  if (!Array.isArray(chain)) return []
  return chain
    .filter((step) => typeof step?.name === 'string' && step.name.length > 0)
    .map((step) => ({ factor: step.name as string, outcome: step.value }))
}

/**
 * Map a `snap-complete` query response onto a `ProgramDecision`.
 *
 *   - `/eligibilityCategory` ∈ {Bce, Ece, Se} → approved
 *   - `/eligibilityCategory` === "Ineligible" → denied (reason code + explanation)
 *   - unresolved (`null`) → pending, with the still-needed info surfaced on
 *     `x-missingInformation` (by field name, never a Fact Graph path)
 *
 * `path` is `auto` — a rules-engine determination with no caseworker in the loop.
 */
export function toProgramDecision(
  query: QueryResponse,
  metadata: Record<string, unknown>,
  notes: TranslationNote[]
): ProgramDecision {
  const category = query.values['/eligibilityCategory']
  const allotment = query.values['/allotment']
  const prorated = query.values['/proratedAllotment']
  const expedited = query.values['/isExpedited']

  let status: DecisionStatus
  let denialReasonCode: string | undefined
  if (category === 'Bce' || category === 'Ece' || category === 'Se') {
    status = 'approved'
  } else if (category === 'Ineligible') {
    const denial = deriveDenial(query)
    status = denial.status
    denialReasonCode = denial.reasonCode
  } else {
    // null — the engine couldn't resolve eligibility with the inputs given.
    status = 'pending'
  }

  const decision: ProgramDecision = {
    metadata,
    program: 'snap',
    status,
    path: 'auto',
  }
  if (denialReasonCode) decision.denialReasonCode = denialReasonCode
  if (typeof allotment === 'number') decision['x-allotment'] = allotment
  if (typeof prorated === 'number') decision['x-proratedAllotment'] = prorated
  if (typeof expedited === 'boolean') decision['x-expedited'] = expedited
  if (status === 'pending' && query.missingInputs?.length) {
    decision['x-missingInformation'] = toMissingInformation(query.missingInputs)
  }
  if (notes.length > 0) decision['x-translationNotes'] = notes
  const explanation = toExplanation(query)
  if ((status === 'denied' || status === 'ineligible') && explanation.length > 0) {
    decision['x-explanation'] = explanation
  }
  return decision
}
