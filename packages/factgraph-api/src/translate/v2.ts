/**
 * v2 eligibility surface — our own engine-shaped contract.
 *
 * Unlike v1 (which conforms to the partner's published ORCA shape), v2 is the
 * surface we define: one household payload, a `programs` list, and a single
 * unified response of `determinations[]` — each tagged `household` or `member`
 * scope so SNAP's one household decision and Medicaid's per-member set share
 * one shape (no `oneOf`). Benefit amounts, expedited status, explanations, and
 * missing-inputs are FIRST-CLASS fields here, not `x-` overlays, because this
 * is our contract to shape.
 *
 * This layer is a reshape + dispatch over the existing per-program translators
 * and result mappers in ./snap and ./medicaid: it runs each requested program
 * on the same engine core and folds the per-program outputs into the unified
 * envelope. The translation/defaulting still lives in those modules.
 *
 * KNOWN FIRST-CUT LIMITATION: this reuses the v1 translators, which map the
 * common applicant fields and default the rest. A pure no-guess request (every
 * absent field comes back as `pending` + missingInputs rather than defaulted)
 * needs the catalog-driven translator that lets a caller set ALL writable
 * fields; that is the next iteration. See docs/engine-inputs.json for the full
 * field set the no-guess surface will accept.
 */
import { z } from 'zod'

import { type QueryResponse } from '../evaluate.js'
import {
  deriveDenial,
  toExplanation,
  type ExplanationStep,
} from './snap.js'
import { type FriendlyMissing } from './field-index.js'

export const SUPPORTED_PROGRAMS = ['snap', 'medicaid'] as const

/** Each object is a bag of friendly fields (see the engine-input catalog);
 *  the translator validates field-by-field against the rules, so the schema
 *  stays permissive rather than re-declaring every field here. */
const bag = () => z.object({}).passthrough()

/**
 * Per-program request: one household payload. Everything is optional except
 * member `id`; an empty body is valid and returns the program pending with the
 * inputs it needs. `asOf` sets the evaluation date ("evaluate as of now" when
 * omitted). `metadata` is opaque and echoed back.
 *
 * Used by the per-program endpoints (/snap/determination, /medicaid/determination).
 */
export const V2HouseholdRequestSchema = z
  .object({
    metadata: z.record(z.string(), z.unknown()).optional(),
    asOf: z.string().optional(),
    household: bag().optional(),
    members: z.array(bag()).optional(),
    caregiverRelationships: z.array(bag()).optional(),
  })
  .passthrough()

export type V2HouseholdRequest = z.infer<typeof V2HouseholdRequestSchema>

/** @deprecated Use V2HouseholdRequestSchema + per-program endpoints. */
export const V2DeterminationRequestSchema = V2HouseholdRequestSchema.extend({
  programs: z.array(z.string()).optional(),
})

export type V2DeterminationRequest = z.infer<typeof V2DeterminationRequestSchema>

export type DeterminationStatus =
  | 'approved'
  | 'denied'
  | 'ineligible'
  | 'pending'
  | 'not_supported'

/** One program's decision. `scope` says whether it is a household-level
 *  decision (SNAP) or a per-member one (Medicaid); `memberId` is set only when
 *  scope is `member`. */
export type Determination = {
  program: string
  scope: 'household' | 'member'
  memberId?: string
  status: DeterminationStatus
  /** `auto` = decided by the rules with no human in the loop. `manual` is
   *  reserved for determinations that will require caseworker verification
   *  once findings are modeled. */
  path?: 'auto' | 'manual'
  /** Monthly benefit when approved, for benefit-amount programs (SNAP). */
  benefitAmount?: number
  proratedFirstMonthAmount?: number
  isExpedited?: boolean
  medicaidCategory?: string
  chpEligible?: boolean
  denialReasonCode?: string
  /** Path-free "why" for denials. */
  explanation?: ExplanationStep[]
  /** Inputs that would unlock or refine this determination, in the friendly
   *  request vocabulary (set by the route via the field index). */
  missingInputs?: FriendlyMissing[]
  /** Assumptions the determination is conditional on (defaulted/derived). */
  notes?: string[]
}

export type V2DeterminationResponse = {
  metadata?: Record<string, unknown>
  asOf: string
  determinations: Determination[]
}

/** Drop undefined keys so the wire shape stays clean. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  for (const k of Object.keys(obj)) if (obj[k] === undefined) delete obj[k]
  return obj
}

/** Pull a per-member value from the positional array the engine returns for
 *  collection facts (each element is a {memberId, value} pair). */
function perMemberValue(
  query: QueryResponse,
  path: string,
  memberId: string
): unknown {
  const arr = query.values[path]
  if (!Array.isArray(arr)) return undefined
  return (arr as Array<{ memberId: string; value: unknown }>).find(
    (e) => e.memberId === memberId
  )?.value
}

/** SNAP QueryResponse → one household-scoped Determination. */
export function snapDetermination(
  query: QueryResponse,
  notes: string[]
): Determination {
  const category = query.values['/eligibilityCategory']
  const allotment = query.values['/allotment']
  const prorated = query.values['/proratedAllotment']
  const expedited = query.values['/isExpedited']

  let status: DeterminationStatus
  let denialReasonCode: string | undefined
  let explanation: ExplanationStep[] | undefined

  if (category === 'Bce' || category === 'Ece' || category === 'Se') {
    status = 'approved'
  } else if (category === 'Ineligible') {
    const denial = deriveDenial(query)
    status = denial.status
    denialReasonCode = denial.reasonCode
    const steps = toExplanation(query)
    if (steps.length > 0) explanation = steps
  } else {
    status = 'pending'
  }

  return compact({
    program: 'snap',
    scope: 'household',
    status,
    path: 'auto',
    benefitAmount: typeof allotment === 'number' ? allotment : undefined,
    proratedFirstMonthAmount: typeof prorated === 'number' ? prorated : undefined,
    isExpedited: typeof expedited === 'boolean' ? expedited : undefined,
    denialReasonCode,
    explanation,
    // missingInputs is attached by the route in the friendly vocabulary.
    notes: notes.length > 0 ? notes : undefined,
  } as Determination)
}

/** Medicaid QueryResponse → one member-scoped Determination per member. */
export function medicaidDeterminations(
  query: QueryResponse,
  memberIds: string[],
  notes: string[]
): Determination[] {
  return memberIds.map((memberId) => {
    const eligible = perMemberValue(query, '/members/*/medicaid', memberId)
    const category = perMemberValue(query, '/members/*/medicaidCategory', memberId)
    const chp = perMemberValue(query, '/members/*/chp', memberId)

    let status: DeterminationStatus
    let denialReasonCode: string | undefined

    if (eligible === true) {
      status = 'approved'
    } else if (eligible === false) {
      status = 'ineligible'
      denialReasonCode =
        category === 'Ineligible'
          ? 'not_in_eligible_category'
          : 'failed_work_or_legal_requirements'
    } else {
      status = 'pending'
    }

    return compact({
      program: 'medicaid',
      scope: 'member',
      memberId,
      status,
      path: 'auto',
      medicaidCategory: typeof category === 'string' ? category : undefined,
      chpEligible: typeof chp === 'boolean' ? chp : undefined,
      denialReasonCode,
      // missingInputs is attached by the route in the friendly vocabulary.
      notes: notes.length > 0 ? notes : undefined,
    } as Determination)
  })
}

/** A determination for a program the engine doesn't implement yet — honest
 *  rather than a fabricated decision or a whole-request failure. */
export function unsupportedDetermination(program: string): Determination {
  return { program, scope: 'household', status: 'not_supported' }
}
