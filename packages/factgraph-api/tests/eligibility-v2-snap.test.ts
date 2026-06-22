/**
 * v2 SNAP eligibility — POST /v2/eligibility/snap/determination.
 * Household-scoped: one request, one determination. Covers no-guess pending +
 * friendly missingInputs, approved path, bad inputs, empty body, and the
 * no-x-/no-path discipline.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

import { app } from './helpers.js'

const URL = '/v2/eligibility/snap/determination'

/** A partial-but-valid friendly request: demographics + income, nothing else.
 *  Under no-guess this leaves SNAP pending (needs many more facts). */
const friendlyRequest = (over: Record<string, unknown> = {}) => ({
  metadata: { caseId: 'v2-snap-test' },
  members: [
    {
      id: 'head',
      dateOfBirth: '1990-03-15',
      citizenshipImmigrationStatus: 'citizen',
      isHeadOfHousehold: true,
      income: [{ type: 'wages_and_salaries', amount: 1200, frequency: 'monthly' }],
    },
  ],
  ...over,
})

test('returns a single household-scoped SNAP determination', async () => {
  const res = await request(app).post(URL).send(friendlyRequest())
  assert.equal(res.status, 200)
  assert.equal(res.body.metadata.caseId, 'v2-snap-test')
  const dets = res.body.determinations as Array<Record<string, unknown>>
  assert.equal(dets.length, 1, 'exactly one determination')
  assert.equal(dets[0].program, 'snap')
  assert.equal(dets[0].scope, 'household')
})

test('pending determination lists missingInputs in the friendly request vocabulary', async () => {
  const res = await request(app).post(URL).send(friendlyRequest())
  const det = (res.body.determinations as Array<Record<string, unknown>>)[0]
  assert.equal(det.status, 'pending')
  const missing = det.missingInputs as Array<Record<string, unknown>>
  assert.ok(Array.isArray(missing) && missing.length > 0, 'expected missingInputs')
  for (const m of missing) {
    assert.ok(typeof m.requestPath === 'string' && m.requestPath.length > 0)
    assert.ok(typeof m.field === 'string' && !(m.field as string).includes('/'))
    assert.ok(typeof m.location === 'string', 'has a location')
    assert.ok(typeof m.label === 'string', 'has a human label')
    assert.ok(!(m.requestPath as string).startsWith('/'), 'requestPath is friendly, not a path')
  }
})

test('an empty body is valid — returns pending with inputs needed', async () => {
  const res = await request(app).post(URL).send({})
  assert.equal(res.status, 200)
  const dets = res.body.determinations as Array<Record<string, unknown>>
  assert.ok(Array.isArray(dets) && dets.length === 1)
  assert.equal(dets[0].status, 'pending')
  assert.equal(res.body.metadata, undefined) // none sent, none echoed
})

test('invalid asOf is a 400 Problem Details', async () => {
  const res = await request(app).post(URL).send(friendlyRequest({ asOf: 'not-a-date' }))
  assert.equal(res.status, 400)
  assert.equal(res.body.status, 400)
  assert.ok(typeof res.body.title === 'string')
})

test('response leaks no x- fields or Fact Graph paths', async () => {
  const res = await request(app).post(URL).send(friendlyRequest())
  const text = JSON.stringify(res.body)
  assert.ok(!/"x-/.test(text), 'no x- overlay fields on the v2 surface')
  assert.ok(!text.includes('/members/*/') && !text.includes('/meets'), 'no Fact Graph paths')
})

// ---------------------------------------------------------------------------
// Expedited screening
// ---------------------------------------------------------------------------

const EXPEDITED_URL = '/v2/eligibility/snap/expedited-screening'

test('expedited screening — returns 200 with isExpedited field', async () => {
  const res = await request(app).post(EXPEDITED_URL).send(friendlyRequest())
  assert.equal(res.status, 200)
  assert.ok('isExpedited' in res.body, 'isExpedited present')
  // isExpedited is boolean when resolved, null when inputs are insufficient.
  assert.ok(
    res.body.isExpedited === null || typeof res.body.isExpedited === 'boolean',
    `isExpedited must be boolean or null, got ${JSON.stringify(res.body.isExpedited)}`
  )
})

test('expedited screening — returns null + missingInputs when inputs are insufficient', async () => {
  // Send no members at all — the screen cannot resolve.
  const res = await request(app).post(EXPEDITED_URL).send({})
  assert.equal(res.status, 200)
  assert.equal(res.body.isExpedited, null)
  const missing = res.body.missingInputs as Array<{ field: string; requestPath: string }>
  assert.ok(Array.isArray(missing) && missing.length > 0, 'missingInputs present when unresolved')
  for (const m of missing) {
    assert.ok(!(m.requestPath as string).startsWith('/'), 'requestPath is friendly')
  }
})

test('expedited screening — invalid asOf is a 400', async () => {
  const res = await request(app).post(EXPEDITED_URL).send({ asOf: 'bad-date', members: [] })
  assert.equal(res.status, 400)
})

test('expedited screening — response leaks no Fact Graph paths', async () => {
  const res = await request(app).post(EXPEDITED_URL).send(friendlyRequest())
  const text = JSON.stringify(res.body)
  assert.ok(!text.includes('/members/*/') && !text.includes('/isExpedited'), 'no engine paths')
})
