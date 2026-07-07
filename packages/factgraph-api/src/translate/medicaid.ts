/**
 * Medicaid translation layer — ORCA → Fact Graph and back.
 *
 * Unlike SNAP (one household-level decision), Medicaid/CHP eligibility is
 * **household-in, per-member-out**: our medicaid graph takes household
 * income + the member roster, derives household size and FPL%, and emits a
 * decision *for each member* (`/members/*\/medicaid`, `/medicaidCategory`,
 * `/chp`). So this endpoint accepts the household-shaped request and returns
 * one decision per member — which is a deliberate divergence from the
 * contract's per-applicant `IndividualDeterminationRequest`, documented in
 * docs/contract-gap-analysis.md.
 *
 * The medicaid graph has no `<CollectionItem>` cross-references (income is
 * household-level scalars, `/members` is the only collection), so the
 * positional-memberId concern that affects SNAP does not apply here.
 */
import type { QueryResponse } from '../evaluate.js'
import {
  toMissingInformation,
  type HouseholdDeterminationRequest,
  type MemberContext,
  type MissingInformation,
  type TranslationNote,
} from './snap.js'

export const MEDICAID_RULESET_ID = 'medicaid'

/** Per-member targets that build the medicaid decisions. `age` is included
 *  not for the response but as the pending guard's signal: the category
 *  Switch's catch-all yields `Ineligible` when the age-gated Whens are
 *  unknown rather than false, so an unresolved age slot means "cannot yet
 *  determine", not "determined ineligible" (see medicaidDeterminations). */
export const MEDICAID_TARGETS = [
  '/members/*/medicaid',
  '/members/*/medicaidCategory',
  '/members/*/chp',
  '/members/*/age',
] as const

// ---------------------------------------------------------------------------
// Value maps (ORCA → medicaid graph enums)
// ---------------------------------------------------------------------------

const CITIZENSHIP_TO_IMMIGRANT: Record<string, string> = {
  us_citizen: 'Citizen',
  us_national: 'Citizen',
}

const IMMIGRATION_TO_IMMIGRANT: Record<string, string> = {
  lawful_permanent_resident: 'LegalPermanentResident',
  refugee: 'Refugee',
  asylee: 'Asylee',
  deportation_withheld: 'DeportationWithheld',
  parolee: 'ParoledForAtLeastOneYear',
  conditional_entrant: 'ConditionalEntrant',
  cuban_haitian_entrant: 'CubanHaitianEntrant',
  temporary_protected_status: 'TemporaryProtectedStatus',
}

const HOURS_PER_WEEK_TO_MONTH = 52 / 12

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

export type TranslatedMedicaidQuery = {
  inputs: Record<string, unknown>
  /** Order-preserving list of member ids, so per-member results can be
   *  zipped back even if the engine returns positional arrays. */
  memberIds: string[]
  notes: TranslationNote[]
}

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

/** Map an ORCA income type onto the rules' income-source enum. Earned vs
 *  unearned is no longer decided here — the ruleset classifies each income row
 *  itself — so we only need a type the engine will classify the same way:
 *  employed to wages (earned), self_employed to self-employment (earned),
 *  unearned to SSI when flagged, else a generic unearned source. */
function medicaidIncomeType(inc: { type?: string; unearnedType?: string }): string {
  if (inc.type === 'self_employed') return 'SelfEmployment'
  if (inc.type === 'unearned') return inc.unearnedType === 'ssi_or_ssdi' ? 'Ssi' : 'Other'
  return 'WagesAndSalaries'
}

/** ORCA frequency → the rules' income-frequency enum (which annualizes). */
const MEDICAID_FREQUENCY: Record<string, string> = {
  monthly: 'Monthly',
  weekly: 'Weekly',
  every_2_weeks: 'BiWeekly',
  twice_a_month: 'SemiMonthly',
  yearly: 'Annual',
}

function mapImmigrant(
  m: MemberContext,
  memberId: string,
  notes: TranslationNote[]
): string {
  const c = m.citizenshipStatus
  if (c === 'us_citizen' || c === 'us_national') return 'Citizen'
  if (c === 'non_citizen') {
    const mapped = m.immigrationStatus
      ? IMMIGRATION_TO_IMMIGRANT[m.immigrationStatus]
      : undefined
    if (mapped) return mapped
    notes.push(
      `member ${memberId}: immigrationStatus "${m.immigrationStatus ?? '(none)'}" has no medicaid mapping — defaulted to "Undocumented".`
    )
    return 'Undocumented'
  }
  if (c !== undefined) {
    notes.push(`member ${memberId}: citizenshipStatus "${c}" unmapped — defaulted to "Citizen".`)
  }
  return CITIZENSHIP_TO_IMMIGRANT[c ?? ''] ?? 'Citizen'
}

/**
 * Translate a household request into medicaid graph inputs. Household income
 * is the sum of every member's `income[]` normalized to monthly and split
 * earned (`employed`/`self_employed`) vs unearned.
 */
export function translateMedicaidHousehold(
  req: HouseholdDeterminationRequest,
  asOf: Date
): TranslatedMedicaidQuery {
  const notes: TranslationNote[] = []
  const memberIds: string[] = []
  const members: Array<Record<string, unknown>> = []
  const incomes: Array<Record<string, unknown>> = []

  for (const [idx, m] of req.members.entries()) {
    // The contract's member has no id; positional fallback keeps per-member
    // decisions addressable.
    const memberId = m.id ?? `member-${idx}`
    memberIds.push(memberId)

    // Itemized income. The ruleset now classifies earned/unearned and
    // annualizes each source (mirroring SNAP), so we emit /incomes rows rather
    // than pre-summing — the earned/unearned split is decided in the rules.
    for (const [i, inc] of (m.income ?? []).entries()) {
      incomes.push({
        id: `${memberId}-income-${i}`,
        '/incomes/*/memberId': `#${idx}`,
        '/incomes/*/type': medicaidIncomeType(
          inc as { type?: string; unearnedType?: string }
        ),
        '/incomes/*/amount': inc.amount,
        '/incomes/*/frequency': MEDICAID_FREQUENCY[inc.frequency ?? 'monthly'] ?? 'Monthly',
      })
    }

    // Derived: monthly hours worked from employment[].
    const monthlyHours = (m as MemberContext & {
      employment?: Array<{ hoursPerWeek?: number }>
    }).employment?.reduce(
      (sum, e) => sum + (typeof e.hoursPerWeek === 'number' ? e.hoursPerWeek : 0),
      0
    )
    // Derived: SSI from unearned income type (note: ORCA conflates SSI+SSDI).
    const receivesSsi = (m.income ?? []).some(
      (inc) => (inc as { unearnedType?: string }).unearnedType === 'ssi_or_ssdi'
    )
    if (receivesSsi) {
      notes.push(
        `member ${memberId}: receivesSsi inferred from income unearnedType "ssi_or_ssdi" — ORCA does not distinguish SSI from SSDI, which the SsiRecipient category requires.`
      )
    }

    const row: Record<string, unknown> = {
      id: memberId,
      // ➕ fields ORCA doesn't carry — defaulted (see contract-gap-analysis.md).
      '/members/*/pregnant': 0,
      '/members/*/daysSincePregnancy': 999999999,
      '/members/*/veteran': false,
      '/members/*/hasDisabledChild': false,
      '/members/*/isFullTimeStudent': false,
      // Covered / derivable from ORCA.
      '/members/*/disabled': m.isDisabled ?? false,
      '/members/*/immigrantStatus': mapImmigrant(m, memberId, notes),
      '/members/*/receivesSsi': receivesSsi,
      '/members/*/monthlyHoursWorked': monthlyHours
        ? Math.round(monthlyHours * HOURS_PER_WEEK_TO_MONTH)
        : 0,
    }
    if (m.dateOfBirth) {
      const age = ageFromDob(m.dateOfBirth, asOf)
      if (age !== undefined) row['/members/*/age'] = age
    }
    members.push(row)
  }

  // Always disclosed — these fields are defaulted on every request and the
  // per-member decisions are conditional on them.
  notes.unshift(
    'Medicaid determination defaults the member fields the ORCA contract ' +
      "doesn't carry (pregnancy, veteran, student, disabled-child); it is " +
      'conditional on those. See docs/contract-gap-analysis.md.'
  )

  return {
    inputs: {
      '/members': members,
      '/incomes': incomes,
    },
    memberIds,
    notes,
  }
}

// ---------------------------------------------------------------------------
// Response mapping — per-member decisions
// ---------------------------------------------------------------------------

export type MemberMedicaidDecision = {
  memberId: string
  status: 'pending' | 'approved' | 'denied' | 'ineligible'
  path: 'auto'
  denialReasonCode?: string
  'x-medicaidCategory'?: string
  'x-chpEligible'?: boolean
}

export type MedicaidDeterminationResponse = {
  metadata: Record<string, unknown>
  program: 'medicaid'
  /** One decision per household member — the household-in/per-member-out shape. */
  decisions: MemberMedicaidDecision[]
  'x-missingInformation'?: MissingInformation[]
  'x-translationNotes'?: string[]
}

/** Pull a per-member value out of the QueryResponse's `[{memberId, value}]` array. */
function perMember(
  query: QueryResponse,
  path: string,
  memberId: string
): unknown {
  const arr = query.values[path]
  if (!Array.isArray(arr)) return undefined
  const hit = (arr as Array<{ memberId: string; value: unknown }>).find(
    (e) => e.memberId === memberId
  )
  return hit?.value
}

export function toMedicaidResponse(
  query: QueryResponse,
  memberIds: string[],
  metadata: Record<string, unknown>,
  notes: TranslationNote[]
): MedicaidDeterminationResponse {
  const decisions: MemberMedicaidDecision[] = memberIds.map((memberId) => {
    const eligible = perMember(query, '/members/*/medicaid', memberId)
    const category = perMember(query, '/members/*/medicaidCategory', memberId)
    const chp = perMember(query, '/members/*/chp', memberId)

    let status: MemberMedicaidDecision['status']
    if (eligible === true) status = 'approved'
    else if (eligible === false) status = 'ineligible'
    else status = 'pending'

    const decision: MemberMedicaidDecision = { memberId, status, path: 'auto' }
    if (typeof category === 'string') decision['x-medicaidCategory'] = category
    if (typeof chp === 'boolean') decision['x-chpEligible'] = chp
    if (status === 'ineligible') {
      // MAGI non-eligibility is categorical (wrong category, legal status, or
      // work requirement) → `ineligible` with a snake_case, state-style code.
      decision.denialReasonCode =
        category === 'Ineligible'
          ? 'not_in_eligible_category'
          : 'failed_work_or_legal_requirements'
    }
    return decision
  })

  const response: MedicaidDeterminationResponse = {
    metadata,
    program: 'medicaid',
    decisions,
  }
  if (query.missingInputs?.length)
    response['x-missingInformation'] = toMissingInformation(query.missingInputs)
  if (notes.length > 0) response['x-translationNotes'] = notes
  return response
}
