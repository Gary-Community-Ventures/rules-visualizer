/**
 * SNAP eligibility endpoints — mounted at /v2/eligibility/snap.
 *
 * POST /snap/determination    — full eligibility determination (household-scoped).
 * POST /snap/expedited-screening — expedited processing screen (7 CFR §273.2(i)).
 *
 * Both are no-guess: only provided fields are evaluated; anything missing comes
 * back as missingInputs in the same request vocabulary.
 */
import { Router } from 'express'
import { getRuleset } from 'rules-visualizer-factgraph-core'

import {
  SNAP_RULESET_ID,
  SNAP_DETERMINATION_TARGETS,
  SNAP_EXPEDITED_TARGET,
} from '../translate/snap.js'
import { translateRequest } from '../translate/v2-request.js'
import { friendlyMissing } from '../translate/field-index.js'
import {
  V2HouseholdRequestSchema,
  snapDetermination,
} from '../translate/v2.js'
import { problem, run, isoDay } from './v2-helpers.js'

const router = Router()

/** Shared: parse + validate the household request, return null on error. */
function parseHouseholdRequest(req: import('express').Request, res: import('express').Response) {
  const parsed = V2HouseholdRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({
      type: 'https://tools.ietf.org/html/rfc9457',
      title: 'Invalid request body',
      status: 400,
      detail: parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; '),
    })
    return null
  }
  const body = parsed.data
  const asOf = body.asOf ? new Date(body.asOf) : new Date()
  if (Number.isNaN(asOf.getTime())) {
    problem(res, 400, 'Invalid asOf', `"${body.asOf}" is not a valid date.`)
    return null
  }
  return { body, asOf }
}

router.post('/determination', (req, res) => {
  const parsed = parseHouseholdRequest(req, res)
  if (!parsed) return
  const { body, asOf } = parsed

  const model = getRuleset(SNAP_RULESET_ID)
  if (!model) {
    problem(res, 503, 'Ruleset unavailable', `"${SNAP_RULESET_ID}" is not loaded.`)
    return
  }
  const { inputs, warnings } = translateRequest(body, model, asOf)
  const query = run(res, SNAP_RULESET_ID, inputs, SNAP_DETERMINATION_TARGETS, ['trace'])
  if (!query) return

  const det = snapDetermination(query, warnings)
  const missing = friendlyMissing(query.missingInputs ?? [], model)
  if (missing.length) det.missingInputs = missing

  res.json({
    ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
    asOf: isoDay(asOf),
    determinations: [det],
  })
})

/**
 * Expedited SNAP screening (7 CFR §273.2(i)).
 *
 * Evaluates whether the household qualifies for expedited processing (benefits
 * within 7 days) without running the full determination. Same no-guess
 * semantics: missing inputs that would change the screen come back in
 * `missingInputs`; `isExpedited` is null when the screen cannot resolve.
 */
router.post('/expedited-screening', (req, res) => {
  const parsed = parseHouseholdRequest(req, res)
  if (!parsed) return
  const { body, asOf } = parsed

  const model = getRuleset(SNAP_RULESET_ID)
  if (!model) {
    problem(res, 503, 'Ruleset unavailable', `"${SNAP_RULESET_ID}" is not loaded.`)
    return
  }
  const { inputs, warnings } = translateRequest(body, model, asOf)
  const query = run(res, SNAP_RULESET_ID, inputs, [SNAP_EXPEDITED_TARGET], undefined)
  if (!query) return

  const isExpedited = query.values[SNAP_EXPEDITED_TARGET]
  const resolved = typeof isExpedited === 'boolean'
  const missing = resolved ? [] : friendlyMissing(query.missingInputs ?? [], model)

  res.json({
    ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
    asOf: isoDay(asOf),
    isExpedited: resolved ? isExpedited : null,
    ...(missing.length ? { missingInputs: missing } : {}),
    ...(warnings.length ? { notes: warnings } : {}),
  })
})

export default router
