/**
 * Medicaid eligibility — POST /v2/eligibility/medicaid/determination.
 *
 * One household payload; returns one member-scoped determination per member.
 * No-guess: only provided fields are evaluated; anything missing comes back
 * as `pending` + `missingInputs` attributed per member (member-specific fields)
 * merged with shared household-level inputs (income rows, etc.).
 *
 * Mounted at /v2/eligibility/medicaid so the tail is /determination.
 */
import { Router } from 'express'
import { getRuleset } from 'rules-visualizer-factgraph-core'

import { MEDICAID_RULESET_ID, MEDICAID_TARGETS } from '../translate/medicaid.js'
import { translateRequest } from '../translate/v2-request.js'
import {
  composeInstancedMissing,
  instancedForMember,
} from '../translate/instanced-missing.js'
import {
  V2HouseholdRequestSchema,
  medicaidDeterminations,
} from '../translate/v2.js'
import { problem, run, isoDay, FIELDS_FORMAT_GONE } from './v2-helpers.js'

const router = Router()

router.post('/determination', (req, res) => {
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
    return
  }
  const body = parsed.data
  const metadata = body.metadata ?? {}
  const asOf = body.asOf ? new Date(body.asOf) : new Date()
  if (Number.isNaN(asOf.getTime())) {
    problem(res, 400, 'Invalid asOf', `"${body.asOf}" is not a valid date.`)
    return
  }

  const model = getRuleset(MEDICAID_RULESET_ID)
  if (!model) {
    problem(res, 503, 'Ruleset unavailable', `"${MEDICAID_RULESET_ID}" is not loaded.`)
    return
  }
  const { inputs, memberIds, warnings, acknowledgment } = translateRequest(body, model, asOf)
  if (body.missingInputsFormat === 'fields') {
    warnings.unshift(FIELDS_FORMAT_GONE)
  }
  const query = run(res, MEDICAID_RULESET_ID, inputs, MEDICAID_TARGETS, [
    'missingInputInstances',
  ])
  if (!query) return

  const dets = medicaidDeterminations(query, memberIds, warnings)
  // One instanced list, sliced per determination: household-level entries
  // (empty `at`) plus the entries whose first hop is that member — the
  // own-plus-shared composition rule, expressed by address.
  const all = composeInstancedMissing(query, memberIds, acknowledgment, model)
  for (const det of dets) {
    if (!det.memberId) continue
    const mine = instancedForMember(all, det.memberId)
    if (mine.length) det.missingInputs = mine
  }

  res.json({
    ...(body.metadata !== undefined ? { metadata } : {}),
    asOf: isoDay(asOf),
    determinations: dets,
  })
})

export default router
