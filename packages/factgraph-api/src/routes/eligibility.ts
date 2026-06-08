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
 * Scope: SNAP is implemented against `snap-complete`. The per-applicant
 * programs (medicaid, chip, tanf, ccdf) and Medicaid ex parte are not yet
 * supported and return 501 with RFC 9457 Problem Details — explicit and
 * honest rather than a fabricated determination.
 */
import { Router } from 'express'
import { getRuleset, getRawFacts } from 'rules-visualizer-factgraph-core'

import { runQuery, type QueryResponse } from '../evaluate.js'
import {
  ExpeditedScreeningRequestSchema,
  HouseholdDeterminationRequestSchema,
  SNAP_RULESET_ID,
  SNAP_DETERMINATION_TARGETS,
  SNAP_EXPEDITED_TARGET,
  translateHouseholdRequest,
  toProgramDecision,
} from '../translate/snap.js'
import { z } from 'zod'

const router = Router()

const PER_MEMBER_PROGRAMS = new Set(['medicaid', 'chip', 'tanf', 'ccdf'])

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
 * Run a set of targets against snap-complete via the shared evaluation
 * core. Returns the QueryResponse, or null after writing a 5xx Problem
 * Details (ruleset not loaded / executable / engine error / a bad target
 * produced by our own translation — all server-side faults, never the
 * caller's).
 */
function evaluateSnap(
  res: import('express').Response,
  inputs: Record<string, unknown>,
  targets: readonly string[],
  include: string[] | undefined,
  metadata: unknown
): QueryResponse | null {
  const model = getRuleset(SNAP_RULESET_ID)
  const facts = getRawFacts(SNAP_RULESET_ID)
  if (!model || !facts) {
    problem(
      res,
      500,
      'Ruleset unavailable',
      `The "${SNAP_RULESET_ID}" ruleset is not loaded or not executable on this server.`
    )
    return null
  }

  let result
  try {
    result = runQuery(SNAP_RULESET_ID, model, facts, {
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
      `Internal targets not found in "${SNAP_RULESET_ID}": ${result.unknownTargets.join(', ')}. This is an adapter bug.`
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

  const { inputs } = translateHouseholdRequest(body, new Date())
  const query = evaluateSnap(
    res,
    inputs,
    [SNAP_EXPEDITED_TARGET],
    undefined,
    metadata
  )
  if (!query) return

  const expedited = query.values[SNAP_EXPEDITED_TARGET]
  res.json({
    metadata,
    expedited: expedited === true,
  })
})

/**
 * POST /v1/eligibility/evaluate/determination
 *
 * Final eligibility determination for one program. SNAP (household
 * program) is evaluated against snap-complete and returned as a
 * ProgramDecision. Per-applicant programs (medicaid/chip/tanf/ccdf) are
 * not yet supported.
 */
router.post('/evaluate/determination', (req, res) => {
  // We only need `program` to route; the full shape is validated once we
  // know it's a SNAP household request.
  const program = (req.body as { program?: unknown })?.program
  if (typeof program !== 'string') {
    return problem(
      res,
      400,
      'Invalid request body',
      'program: required string (e.g. "snap", "medicaid").'
    )
  }

  if (program !== 'snap') {
    if (PER_MEMBER_PROGRAMS.has(program)) {
      return problem(
        res,
        501,
        'Program not supported',
        `Determination for "${program}" is not yet implemented by this adapter. ` +
          `SNAP determination and expedited screening are available today.`
      )
    }
    return problem(
      res,
      400,
      'Unknown program',
      `Unrecognized program "${program}".`
    )
  }

  const parsed = HouseholdDeterminationRequestSchema.safeParse(req.body)
  if (!parsed.success) return badBody(res, parsed.error)
  const body = parsed.data
  const metadata = body.metadata ?? {}

  const { inputs, notes } = translateHouseholdRequest(body, new Date())
  // Only pull trace material when the caller opted in — it's the
  // denialReasonCode source and is otherwise extra work.
  const include = body.include?.includes('trace') ? ['trace'] : undefined
  const query = evaluateSnap(
    res,
    inputs,
    SNAP_DETERMINATION_TARGETS,
    include,
    metadata
  )
  if (!query) return

  res.json(toProgramDecision(query, metadata, notes))
})

/**
 * POST /v1/eligibility/evaluate/medicaid-ex-parte
 *
 * Not yet supported. The Medicaid ex parte flow depends on electronic
 * data-exchange (FDSH FTI, Medicare/VCI) results that this adapter does
 * not yet model. Returns 501 rather than a fabricated determination.
 */
router.post('/evaluate/medicaid-ex-parte', (_req, res) => {
  problem(
    res,
    501,
    'Not supported',
    'Medicaid ex parte evaluation is not yet implemented by this adapter. ' +
      'It requires electronic data-exchange results (FDSH FTI, Medicare/VCI) ' +
      'that are not yet modeled. SNAP determination and expedited screening ' +
      'are available today.'
  )
})

export default router
