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
import { friendlyMissing } from '../translate/field-index.js'
import {
  V2HouseholdRequestSchema,
  medicaidDeterminations,
} from '../translate/v2.js'
import { problem, run, isoDay } from './v2-helpers.js'

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
  const { inputs, memberIds, warnings } = translateRequest(body, model, asOf)
  const query = run(res, MEDICAID_RULESET_ID, inputs, MEDICAID_TARGETS, undefined)
  if (!query) return

  const dets = medicaidDeterminations(query, memberIds, warnings)
  for (const det of dets) {
    if (det.status !== 'pending') continue
    // Per-member attribution: combine this member's member-level missing fields
    // with shared household-level inputs (income rows, etc.) from the top-level
    // union. Falls back to the full union when no per-member breakdown exists.
    const perMember =
      det.memberId ? query.missingInputsByMember?.[det.memberId] : undefined
    let raw: typeof query.missingInputs
    if (perMember) {
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

  res.json({
    ...(body.metadata !== undefined ? { metadata } : {}),
    asOf: isoDay(asOf),
    determinations: dets,
  })
})

export default router
