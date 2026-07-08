/**
 * v2 eligibility surface — our own engine-shaped contract.
 *
 * Unlike v1 (which conforms to the partner's published ORCA shape), v2 is the
 * surface we define: one household payload per per-program endpoint, and a
 * unified response of `determinations[]` — each tagged `household` or `member`
 * scope so SNAP's one household decision and Medicaid's per-member set share
 * one shape (no `oneOf`). Benefit amounts, expedited status, explanations, and
 * missing-inputs are FIRST-CLASS fields here, not `x-` overlays, because this
 * is our contract to shape.
 *
 * Requests are translated by the catalog-driven no-guess translator
 * (./v2-request.ts, driven by ./field-index.ts): only fields the caller
 * provided reach the engine, and anything absent comes back as `pending` +
 * missingInputs in the request vocabulary. Nothing is defaulted — that is
 * the deliberate contrast with the v1 ORCA adapter, which fills the fields
 * its contract can't carry. This module holds the shared response shapes and
 * the per-program result mappers (QueryResponse → Determination).
 */
import { z } from 'zod'

import { type QueryResponse } from '../evaluate.js'
import {
  deriveDenial,
  toExplanation,
  type ExplanationStep,
} from './snap.js'
import { snakeEnum, type FriendlyMissing } from './field-index.js'
import { type InstancedMissing } from './instanced-missing.js'

export const SUPPORTED_PROGRAMS = ['snap', 'medicaid'] as const

/** Each object is a bag of friendly fields (see the engine-input catalog);
 *  the translator validates field-by-field against the rules, so the schema
 *  stays permissive rather than re-declaring every field here. */
const bag = () => z.object({}).passthrough()

/** A member: an open bag, except the sub-collections (income, expenses,
 *  jobs, assets) must be arrays of row objects when present — a null or
 *  primitive row is a caller error the translator can't interpret. */
const memberBag = () =>
  z
    .object({
      income: z.array(bag()).optional(),
      expenses: z.array(bag()).optional(),
      jobs: z.array(bag()).optional(),
      assets: z.array(bag()).optional(),
    })
    .passthrough()

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
    /** DEPRECATED and ignored — missingInputs is always instanced now.
     *  Still accepted so requests written during the evaluation window
     *  don't 400; sending "fields" earns a note explaining the migration. */
    missingInputsFormat: z.enum(['fields', 'instanced']).optional(),
    household: bag().optional(),
    members: z.array(memberBag()).optional(),
    caregiverRelationships: z.array(bag()).optional(),
  })
  .passthrough()
  // Identity discipline. Member ids correlate determinations, per-member
  // missing inputs, instance addresses, and reference fields (spouseId
  // etc.) back to request rows — a duplicate, empty, or non-string id
  // silently merges or orphans people, so reject them outright. Uniqueness
  // is checked over EFFECTIVE ids (explicit id, or the positional
  // `member-N` fallback), so a member literally named "member-1" cannot
  // collide with another member's fallback. Row ids within a member's
  // sub-collection must likewise be unique or the instanced missing-input
  // addresses become ambiguous.
  .superRefine((body, ctx) => {
    const seen = new Set<string>()
    ;(body.members ?? []).forEach((m, i) => {
      const rec = m as Record<string, unknown>
      const id = rec.id
      if (id !== undefined && (typeof id !== 'string' || id.length === 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['members', i, 'id'],
          message: 'member id must be a non-empty string',
        })
        return
      }
      const effective = (id as string | undefined) ?? `member-${i}`
      if (seen.has(effective)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['members', i, 'id'],
          message: `duplicate member id "${effective}" — ids must be unique, including the positional member-N fallbacks`,
        })
      }
      seen.add(effective)

      for (const key of ['income', 'expenses', 'jobs', 'assets'] as const) {
        const rows = rec[key]
        if (!Array.isArray(rows)) continue
        const rowSeen = new Set<string>()
        rows.forEach((r, j) => {
          const rid = (r as Record<string, unknown>)?.id
          if (rid === undefined) return
          if (typeof rid !== 'string' || rid.length === 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['members', i, key, j, 'id'],
              message: 'row id must be a non-empty string',
            })
            return
          }
          if (rowSeen.has(rid)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['members', i, key, j, 'id'],
              message: `duplicate ${key} row id "${rid}" within this member — row addresses would be ambiguous`,
            })
          }
          rowSeen.add(rid)
        })
      }
    })
  })

export type V2HouseholdRequest = z.infer<typeof V2HouseholdRequestSchema>

export type DeterminationStatus =
  | 'approved'
  | 'denied'
  | 'ineligible'
  | 'pending'

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
  /** Inputs that would unlock or refine this determination: one entry per
   *  concrete instance, addressed by `at` hops, plus "unacknowledged"
   *  collection questions (set by the route via the composer). */
  missingInputs?: InstancedMissing[]
  /** DEPRECATED — derivable from missingInputs by grouping entries on
   *  `at[0].id`. Kept while integrators migrate; will be removed. */
  missingInputsByMember?: Record<string, FriendlyMissing[]>
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

  // Finality gate: the category resolved, but only by stepping past
  // unanswered questions (skipped Switch cases, summed-past rows). A
  // decision that would change once those are answered is not a decision.
  const conditional =
    (query.conditionalTargets?.['/eligibilityCategory']?.length ?? 0) > 0

  let status: DeterminationStatus
  let denialReasonCode: string | undefined
  let explanation: ExplanationStep[] | undefined

  if (conditional && typeof category === 'string') {
    status = 'pending'
  } else if (category === 'Bce' || category === 'Ece' || category === 'Se') {
    status = 'approved'
  } else if (category === 'Ineligible') {
    const denial = deriveDenial(query)
    // The Switch's default `True → Ineligible` case fires when every preceding
    // When condition (BCE, ECE, SE) is null/pending rather than definitively
    // false — for example when household-membership flags like isSeparateAndApart
    // are absent and the engine can't compute householdSize. A real denial always
    // has a recognized gate on the decisive path (reasonCode ≠ 'other'). If the
    // trace has no recognized gate AND the query is still incomplete, treat the
    // result as pending rather than committed denial.
    if (denial.reasonCode === 'other' && query.status === 'incomplete') {
      status = 'pending'
    } else {
      status = denial.status
      denialReasonCode = denial.reasonCode
      const steps = toExplanation(query)
      if (steps.length > 0) explanation = steps
    }
  } else {
    status = 'pending'
  }

  return compact({
    program: 'snap',
    scope: 'household',
    status,
    path: 'auto',
    // Numbers computed against a conditional category would misread as
    // findings — suppressed on pending like the denial fields.
    benefitAmount:
      status !== 'pending' && typeof allotment === 'number' ? allotment : undefined,
    proratedFirstMonthAmount:
      status !== 'pending' && typeof prorated === 'number' ? prorated : undefined,
    isExpedited:
      status !== 'pending' && typeof expedited === 'boolean' ? expedited : undefined,
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
  // Finality gate, per member: a member's decision is conditional when the
  // support check flagged their sub-trace (the category Switch stepped past
  // Whens it couldn't evaluate) or when a household-level conditionality
  // exists (an incomplete income row skews the shared aggregates every
  // member's decision reads). Subsumes the earlier age-only guard.
  const conditionalFor = (memberId: string): boolean => {
    for (const groups of Object.values(query.conditionalTargets ?? {})) {
      for (const g of groups) {
        if (g.memberId === undefined || g.memberId === memberId) return true
      }
    }
    return false
  }

  return memberIds.map((memberId) => {
    const eligible = perMemberValue(query, '/members/*/medicaid', memberId)
    const category = perMemberValue(query, '/members/*/medicaidCategory', memberId)
    const chp = perMemberValue(query, '/members/*/chp', memberId)

    let status: DeterminationStatus
    let denialReasonCode: string | undefined

    if (eligible !== true && eligible !== false) {
      status = 'pending'
    } else if (conditionalFor(memberId)) {
      // The value resolved only by stepping past unanswered questions —
      // a decision that would change once they're answered is not final.
      status = 'pending'
    } else if (eligible === true) {
      status = 'approved'
    } else {
      status = 'ineligible'
      denialReasonCode =
        category === 'Ineligible'
          ? 'not_in_eligible_category'
          : 'failed_work_or_legal_requirements'
    }

    return compact({
      program: 'medicaid',
      scope: 'member',
      memberId,
      status,
      path: 'auto',
      // Engine enum options are PascalCase internally; the wire convention
      // is snake_case (matching request enum values and reason codes).
      // Suppressed on pending — a category that exists only because the
      // Switch defaulted on missing input would misread as a finding.
      medicaidCategory:
        status !== 'pending' && typeof category === 'string'
          ? snakeEnum(category)
          : undefined,
      chpEligible: status !== 'pending' && typeof chp === 'boolean' ? chp : undefined,
      denialReasonCode,
      // missingInputs is attached by the route in the friendly vocabulary.
      notes: notes.length > 0 ? notes : undefined,
    } as Determination)
  })
}
