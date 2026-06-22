/**
 * v2 eligibility surface — our own engine-shaped contract (see ../translate/v2.ts).
 *
 * One endpoint: POST /v2/eligibility/evaluate/determination. Send one household
 * payload plus a `programs` list; get back a unified `determinations[]` with a
 * decision per program (household-scoped for SNAP, one per member for Medicaid).
 * Expedited screening folds into the SNAP determination (`isExpedited`); ex
 * parte will be a later `mode` on this same endpoint rather than a separate one.
 *
 * Mounted at /v2/eligibility so the tail is /evaluate/determination, parallel to
 * the v1 surface.
 */
import { Router } from 'express'
import { getRuleset, getRawFacts } from 'rules-visualizer-factgraph-core'
import { z } from 'zod'

import { runQuery, type QueryResponse } from '../evaluate.js'
import { SNAP_RULESET_ID, SNAP_DETERMINATION_TARGETS } from '../translate/snap.js'
import { MEDICAID_RULESET_ID, MEDICAID_TARGETS } from '../translate/medicaid.js'
import { translateRequest } from '../translate/v2-request.js'
import { friendlyMissing } from '../translate/field-index.js'
import {
  V2DeterminationRequestSchema,
  SUPPORTED_PROGRAMS,
  snapDetermination,
  medicaidDeterminations,
  unsupportedDetermination,
  type Determination,
} from '../translate/v2.js'

const router = Router()

function problem(
  res: import('express').Response,
  status: number,
  title: string,
  detail: string
): void {
  res
    .status(status)
    .json({ type: 'https://tools.ietf.org/html/rfc9457', title, status, detail })
}

/** Run targets against a ruleset; returns the response, or null after writing
 *  a 5xx Problem Details (all server-side faults — a missing ruleset or a bad
 *  target our own translation produced, never the caller's input). */
function run(
  res: import('express').Response,
  rulesetId: string,
  inputs: Record<string, unknown>,
  targets: readonly string[],
  include: string[] | undefined
): QueryResponse | null {
  const model = getRuleset(rulesetId)
  const facts = getRawFacts(rulesetId)
  if (!model || !facts) {
    problem(res, 503, 'Ruleset unavailable', `"${rulesetId}" is not loaded.`)
    return null
  }
  const result = runQuery(rulesetId, model, facts, {
    targets: [...targets],
    inputs,
    include,
  })
  if (!result.ok) {
    problem(
      res,
      500,
      'Internal evaluation error',
      `Targets not found in "${rulesetId}": ${result.unknownTargets.join(', ')}. This is an adapter bug.`
    )
    return null
  }
  return result.response
}

/** ISO yyyy-mm-dd (UTC) for the echoed evaluation date. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

router.post('/evaluate/determination', (req, res) => {
  const parsed = V2DeterminationRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({
      type: 'https://tools.ietf.org/html/rfc9457',
      title: 'Invalid request body',
      status: 400,
      detail: parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; '),
    })
    return
  }
  const body = parsed.data
  const metadata = body.metadata ?? {}
  const asOf = body.asOf ? new Date(body.asOf) : new Date()
  if (Number.isNaN(asOf.getTime())) {
    problem(res, 400, 'Invalid asOf', `"${body.asOf}" is not a valid date.`)
    return
  }
  // Dedupe while preserving request order; default to every supported program.
  const programs = [...new Set(body.programs ?? SUPPORTED_PROGRAMS)]

  const determinations: Determination[] = []

  for (const program of programs) {
    if (program === 'snap') {
      const model = getRuleset(SNAP_RULESET_ID)
      if (!model) { problem(res, 503, 'Ruleset unavailable', `"${SNAP_RULESET_ID}" is not loaded.`); return }
      // No-guess: only provided fields are translated; the rest come back missing.
      const { inputs, warnings } = translateRequest(body, model, asOf)
      // Trace is computed internally — the source of the denial reason + explanation.
      const query = run(res, SNAP_RULESET_ID, inputs, SNAP_DETERMINATION_TARGETS, ['trace'])
      if (!query) return
      const det = snapDetermination(query, metadata, warnings)
      const missing = friendlyMissing(query.missingInputs ?? [], model)
      if (missing.length) det.missingInputs = missing
      determinations.push(det)
    } else if (program === 'medicaid') {
      const model = getRuleset(MEDICAID_RULESET_ID)
      if (!model) { problem(res, 503, 'Ruleset unavailable', `"${MEDICAID_RULESET_ID}" is not loaded.`); return }
      const { inputs, memberIds, warnings } = translateRequest(body, model, asOf)
      const query = run(res, MEDICAID_RULESET_ID, inputs, MEDICAID_TARGETS, undefined)
      if (!query) return
      const dets = medicaidDeterminations(query, memberIds, metadata, warnings)
      for (const det of dets) {
        if (det.status !== 'pending') continue
        // Per-member attribution: combine this member's specific member-level
        // missing fields with any shared household-level inputs (income rows,
        // etc.) from the top-level union. Falls back to the full union when no
        // per-member breakdown is available.
        const perMember =
          det.memberId ? query.missingInputsByMember?.[det.memberId] : undefined
        let raw: typeof query.missingInputs
        if (perMember) {
          // Member-specific fields, then shared (non-member-collection) fields.
          const sharedMissing = (query.missingInputs ?? []).filter(
            (m) => !m.path.startsWith('/members/*/')
          )
          raw = [...perMember, ...sharedMissing]
        } else {
          raw = query.missingInputs ?? []
        }
        const friendly = friendlyMissing(raw, model)
        if (friendly.length) det.missingInputs = friendly
      }
      determinations.push(...dets)
    } else {
      determinations.push(unsupportedDetermination(program))
    }
  }

  res.json({
    ...(body.metadata !== undefined ? { metadata } : {}),
    asOf: isoDay(asOf),
    determinations,
  })
})

export default router
