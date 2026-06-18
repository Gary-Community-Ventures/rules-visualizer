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
  toProgramDecision,
  type ExplanationStep,
} from './snap.js'
import { toMedicaidResponse } from './medicaid.js'
import { type FriendlyMissing } from './field-index.js'

export const SUPPORTED_PROGRAMS = ['snap', 'medicaid'] as const

/** Each object is a bag of friendly fields (see the engine-input catalog);
 *  the translator validates field-by-field against the rules, so the schema
 *  stays permissive rather than re-declaring every field here. */
const bag = () => z.object({}).passthrough()

/**
 * The v2 request: friendly fields, everything optional. Members carry their
 * fields plus nested `income`/`expenses`/`jobs`/`assets`. Omit `programs` to
 * run every supported program; send an empty body to get every program back
 * `pending` with the inputs each still needs. `asOf` sets the evaluation date
 * ("evaluate as of now" when omitted). `metadata` is opaque and echoed back.
 */
export const V2DeterminationRequestSchema = z
  .object({
    metadata: z.record(z.string(), z.unknown()).optional(),
    programs: z.array(z.string()).optional(),
    asOf: z.string().optional(),
    household: bag().optional(),
    members: z.array(bag()).optional(),
    caregiverRelationships: z.array(bag()).optional(),
  })
  .passthrough()

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

/** SNAP QueryResponse → one household-scoped Determination, by reshaping the
 *  v1 ProgramDecision (first-class fields instead of `x-` overlays). */
export function snapDetermination(
  query: QueryResponse,
  metadata: Record<string, unknown>,
  notes: string[]
): Determination {
  const pd = toProgramDecision(query, metadata, notes)
  return compact({
    program: 'snap',
    scope: 'household',
    status: pd.status,
    path: pd.path,
    benefitAmount: pd['x-allotment'],
    proratedFirstMonthAmount: pd['x-proratedAllotment'],
    isExpedited: pd['x-expedited'],
    denialReasonCode: pd.denialReasonCode,
    explanation: pd['x-explanation'],
    // missingInputs is attached by the route in the friendly vocabulary.
    notes: pd['x-translationNotes'],
  })
}

/** Medicaid QueryResponse → one member-scoped Determination per member. */
export function medicaidDeterminations(
  query: QueryResponse,
  memberIds: string[],
  metadata: Record<string, unknown>,
  notes: string[]
): Determination[] {
  const mr = toMedicaidResponse(query, memberIds, metadata, notes)
  return mr.decisions.map((d) =>
    compact({
      program: 'medicaid',
      scope: 'member',
      memberId: d.memberId,
      status: d.status,
      path: d.path,
      medicaidCategory: d['x-medicaidCategory'],
      chpEligible: d['x-chpEligible'],
      denialReasonCode: d.denialReasonCode,
      // missingInputs is attached by the route in the friendly vocabulary.
      notes: mr['x-translationNotes'],
    })
  )
}

/** A determination for a program the engine doesn't implement yet — honest
 *  rather than a fabricated decision or a whole-request failure. */
export function unsupportedDetermination(program: string): Determination {
  return { program, scope: 'household', status: 'not_supported' }
}
