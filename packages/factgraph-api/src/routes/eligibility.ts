/**
 * Eligibility adapter endpoints — domain-oriented wrappers conforming to
 * the partner team's eligibility adapter contract
 * (https://github.com/codeforamerica/safety-net-blueprint,
 * `packages/contracts/eligibility-adapter-openapi.yaml`).
 *
 * These are the "state-provided eligibility evaluation adapter" the
 * blueprint calls. The caller (Worker Portal) sends ORCA-shaped requests
 * and receives `ProgramDecision`s; it never sees a Fact Graph path. All
 * the path translation, defaulting, and result mapping is owned here and
 * in `../translate/snap.ts`, on top of the same execution core
 * (`../evaluate.ts`) that powers the generic `/query` route.
 *
 * Mounted at `/v1/eligibility`, so the contract's bare `/evaluate/...`
 * tails resolve correctly when a consumer configures its adapter base URL
 * to `<host>/v1/eligibility` — zero path rewriting on their side, while we
 * keep a versioned namespace distinct from the generic `/v1/factgraph`
 * surface.
 *
 * Scope: SNAP (determination + expedited screening, against `snap-complete`)
 * and Medicaid (determination, against `medicaid`; household-shaped or the
 * contract's per-applicant shape with a disclosed sole-applicant assumption)
 * are implemented. chip/tanf/ccdf and Medicaid ex parte return 501 with RFC
 * 9457 Problem Details — explicit and honest rather than a fabricated
 * determination. Conformance to the published contract is documented
 * clause-by-clause in docs/v1-conformance.md.
 */
import { Router } from 'express'
import { getRuleset, getRawFacts } from 'rules-visualizer-factgraph-core'

import { runQuery, type QueryResponse } from '../evaluate.js'
import {
  ExpeditedScreeningRequestSchema,
  HouseholdDeterminationRequestSchema,
  IndividualDeterminationRequestSchema,
  SNAP_RULESET_ID,
  SNAP_DETERMINATION_TARGETS,
  SNAP_EXPEDITED_TARGET,
  translateHouseholdRequest,
  toProgramDecision,
  toMissingInformation,
  type HouseholdDeterminationRequest,
} from '../translate/snap.js'
import {
  MEDICAID_RULESET_ID,
  MEDICAID_TARGETS,
  translateMedicaidHousehold,
  toMedicaidResponse,
} from '../translate/medicaid.js'
import { z } from 'zod'

const router = Router()

function problem(
  res: import('express').Response,
  status: number,
  title: string,
  detail: string
): void {
  res.status(status).json({
    type: 'https://tools.ietf.org/html/rfc9457',
    title,
    status,
    detail,
  })
}

function badBody(res: import('express').Response, error: z.ZodError): void {
  res.status(400).json({
    type: 'https://tools.ietf.org/html/rfc9457',
    title: 'Invalid request body',
    status: 400,
    detail: error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; '),
    errors: error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })),
  })
}

/**
 * Run a set of targets against a ruleset via the shared evaluation core.
 * Returns the QueryResponse, or null after writing a 5xx Problem Details
 * (ruleset not loaded / executable / engine error / a bad target produced
 * by our own translation — all server-side faults, never the caller's).
 */
function evaluateRuleset(
  res: import('express').Response,
  rulesetId: string,
  inputs: Record<string, unknown>,
  targets: readonly string[],
  include: string[] | undefined,
  metadata: unknown
): QueryResponse | null {
  const model = getRuleset(rulesetId)
  const facts = getRawFacts(rulesetId)
  if (!model || !facts) {
    // 503 (matching the v2 surface): a server-state fault the caller can
    // retry, not a permanent failure of the request.
    problem(
      res,
      503,
      'Ruleset unavailable',
      `The "${rulesetId}" ruleset is not loaded or not executable on this server.`
    )
    return null
  }

  let result
  try {
    result = runQuery(rulesetId, model, facts, {
      targets: [...targets],
      inputs,
      include,
      metadata,
    })
  } catch (e) {
    problem(res, 500, 'Evaluation failed', (e as Error).message)
    return null
  }

  if (!result.ok) {
    // A target our translation asked for doesn't exist in the ruleset —
    // an adapter bug, not the caller's. Surface it as a 500 so it's caught
    // in our own monitoring rather than blamed on the request.
    problem(
      res,
      500,
      'Adapter misconfiguration',
      `Internal targets not found in "${rulesetId}": ${result.unknownTargets.join(', ')}. This is an adapter bug.`
    )
    return null
  }

  return result.response
}

/**
 * POST /v1/eligibility/evaluate/expedited-screening
 *
 * Expedited SNAP screening (7 CFR §273.2(i)). Returns the contract's
 * ExpeditedScreeningResponse: `{ metadata, expedited }`.
 */
router.post('/evaluate/expedited-screening', (req, res) => {
  const parsed = ExpeditedScreeningRequestSchema.safeParse(req.body)
  if (!parsed.success) return badBody(res, parsed.error)
  const body = parsed.data
  const metadata = body.metadata ?? {}

  const { inputs, notes } = translateHouseholdRequest(body, new Date())
  const query = evaluateRuleset(
    res,
    SNAP_RULESET_ID,
    inputs,
    [SNAP_EXPEDITED_TARGET],
    undefined,
    metadata
  )
  if (!query) return

  // The contract's response is just {metadata, expedited}. When the screen
  // could not actually be computed (e.g. the contract's household-only shape
  // carries no income or liquid resources), we answer a conservative `false`
  // and say what was missing rather than presenting an unknown as a result.
  // Translation notes (defaulted flags, the household-only disclosure) ride
  // the same x- overlay as on the determination endpoints.
  const expedited = query.values[SNAP_EXPEDITED_TARGET]
  res.json({
    metadata,
    expedited: expedited === true,
    ...(expedited === null || expedited === undefined
      ? { 'x-missingInformation': toMissingInformation(query.missingInputs) }
      : {}),
    ...(notes.length > 0 ? { 'x-translationNotes': notes } : {}),
  })
})

/** Programs whose determination isn't implemented yet (recognized, 501). */
const UNSUPPORTED_PROGRAMS = new Set(['chip', 'tanf', 'ccdf'])

/**
 * POST /v1/eligibility/evaluate/determination
 *
 * Final eligibility determination for one program.
 *   - `snap` (household program) → one `ProgramDecision` for the household.
 *   - `medicaid` (household-in, per-member-out) → a `MedicaidDeterminationResponse`
 *     carrying one decision per member. This deliberately uses the
 *     household-shaped request rather than the contract's per-applicant
 *     `IndividualDeterminationRequest`, because MAGI Medicaid eligibility for
 *     any one member depends on the whole household's size and income. See
 *     docs/contract-gap-analysis.md.
 *   - `chip`/`tanf`/`ccdf` → 501 (not yet implemented).
 */
router.post('/evaluate/determination', (req, res) => {
  // We only need `program` to route; the full shape is validated below.
  const program = (req.body as { program?: unknown })?.program
  if (typeof program !== 'string') {
    return problem(
      res,
      400,
      'Invalid request body',
      'program: required string (e.g. "snap", "medicaid").'
    )
  }

  if (program !== 'snap' && program !== 'medicaid') {
    if (UNSUPPORTED_PROGRAMS.has(program)) {
      return problem(
        res,
        501,
        'Program not supported',
        `Determination for "${program}" is not yet implemented by this adapter. ` +
          `SNAP and Medicaid determination and SNAP expedited screening are available today.`
      )
    }
    return problem(res, 400, 'Unknown program', `Unrecognized program "${program}".`)
  }

  // Preferred shape for both programs: household (members[] + household).
  // For conformance we also accept the contract's per-applicant
  // IndividualDeterminationRequest (single `member`) for medicaid, wrapping
  // it as a household whose only known member is the applicant — with that
  // assumption disclosed, since MAGI results depend on the full household.
  let body: HouseholdDeterminationRequest
  const wrapNotes: string[] = []
  const looksIndividual =
    program === 'medicaid' &&
    (req.body as { member?: unknown })?.member !== undefined &&
    (req.body as { members?: unknown })?.members === undefined
  if (looksIndividual) {
    const parsedIndividual = IndividualDeterminationRequestSchema.safeParse(req.body)
    if (!parsedIndividual.success) return badBody(res, parsedIndividual.error)
    const ind = parsedIndividual.data
    body = {
      metadata: ind.metadata,
      program: ind.program,
      household: {},
      members: [ind.member],
      verificationSummary: ind.verificationSummary,
    } as HouseholdDeterminationRequest
    wrapNotes.push(
      'Per-applicant request: household context was assumed to be the sole ' +
        'applicant. MAGI eligibility depends on full household size and ' +
        'income — an orchestration layer holding the case record should ' +
        'supply the whole household for an accurate result.'
    )
  } else {
    const parsed = HouseholdDeterminationRequestSchema.safeParse(req.body)
    if (!parsed.success) return badBody(res, parsed.error)
    body = parsed.data
  }
  const metadata = body.metadata ?? {}

  if (program === 'medicaid') {
    const { inputs, memberIds, notes } = translateMedicaidHousehold(body, new Date())
    notes.push(...wrapNotes)
    const query = evaluateRuleset(
      res,
      MEDICAID_RULESET_ID,
      inputs,
      MEDICAID_TARGETS,
      undefined,
      metadata
    )
    if (!query) return
    return void res.json(toMedicaidResponse(query, memberIds, metadata, notes))
  }

  // SNAP. Always compute the trace internally — it's the source of the
  // (path-free) denialReasonCode + x-explanation. The consumer never opts
  // into a Fact-Graph-flavored "include" flag; the raw trace stays internal.
  const { inputs, notes } = translateHouseholdRequest(body, new Date())
  const query = evaluateRuleset(
    res,
    SNAP_RULESET_ID,
    inputs,
    SNAP_DETERMINATION_TARGETS,
    ['trace'],
    metadata
  )
  if (!query) return

  res.json(toProgramDecision(query, metadata, notes))
})

/**
 * POST /v1/eligibility/evaluate/medicaid-ex-parte
 *
 * Not yet implemented — but not for engine reasons. Ex parte is the same
 * MAGI determination the medicaid graph already computes, reached through a
 * different evidentiary pathway (electronic data exchange + a "every
 * required check must be conclusive" gate). Implementation is pending three
 * contract clarifications (serviceResult payload schemas, household context
 * on the per-applicant call, and the `path: ex_parte` enum value) — see
 * docs/contract-gap-analysis.md § Medicaid ex parte. Returns 501 rather
 * than a fabricated determination.
 */
router.post('/evaluate/medicaid-ex-parte', (_req, res) => {
  problem(
    res,
    501,
    'Not implemented',
    'Medicaid ex parte evaluation is not yet implemented. The underlying ' +
      'rules are ready (the same medicaid determination available at ' +
      '/evaluate/determination); implementation awaits contract ' +
      'clarifications on the electronic-check result schemas and household ' +
      'context. See docs/contract-gap-analysis.md in the repository.'
  )
})

export default router
