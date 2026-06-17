/**
 * v2 eligibility surface — POST /v2/eligibility/evaluate/determination.
 * Covers the unified determinations[] shape, multi-program dispatch, the
 * household-vs-member scope split, unsupported programs, the empty call, and
 * the no-x-/no-paths discipline.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

import { app } from './helpers.js'

const URL = '/v2/eligibility/evaluate/determination'

const eligibleHousehold = (over: Record<string, unknown> = {}) => ({
  metadata: { caseId: 'v2-demo' },
  household: { size: 1 },
  members: [
    {
      id: 'head',
      dateOfBirth: '1990-03-15',
      citizenshipStatus: 'us_citizen',
      relationshipToHead: 'head_of_household',
      isDisabled: false,
      income: [{ type: 'employed', amount: 1200, frequency: 'monthly' }],
      expenses: [{ category: 'housing', amount: 800, frequency: 'monthly' }],
      assets: [{ type: 'liquid', value: 500 }],
    },
  ],
  ...over,
})

test('runs every supported program by default, unified determinations[]', async () => {
  const res = await request(app).post(URL).send(eligibleHousehold())
  assert.equal(res.status, 200)
  assert.equal(res.body.metadata.caseId, 'v2-demo')
  assert.ok(typeof res.body.asOf === 'string')
  const dets = res.body.determinations as Array<Record<string, unknown>>
  assert.ok(Array.isArray(dets) && dets.length > 0)

  const snap = dets.find((d) => d.program === 'snap')
  assert.ok(snap, 'expected a snap determination')
  assert.equal(snap!.scope, 'household')
  assert.equal(snap!.path, 'auto')
  assert.equal(snap!.status, 'approved')
  assert.equal(snap!.benefitAmount, 200) // first-class, not x-allotment
  assert.equal(typeof snap!.isExpedited, 'boolean')

  const medicaid = dets.filter((d) => d.program === 'medicaid')
  assert.ok(medicaid.length >= 1, 'expected per-member medicaid determinations')
  assert.equal(medicaid[0].scope, 'member')
  assert.equal(medicaid[0].memberId, 'head')
})

test('programs filter runs only what was asked', async () => {
  const res = await request(app)
    .post(URL)
    .send(eligibleHousehold({ programs: ['snap'] }))
  assert.equal(res.status, 200)
  const programs = new Set(
    (res.body.determinations as Array<{ program: string }>).map((d) => d.program)
  )
  assert.deepEqual([...programs], ['snap'])
})

test('over-income SNAP is denied with a specific reason and explanation', async () => {
  const req = eligibleHousehold({ programs: ['snap'] })
  req.members[0].income = [{ type: 'employed', amount: 9000, frequency: 'monthly' }]
  const res = await request(app).post(URL).send(req)
  const snap = (res.body.determinations as Array<Record<string, unknown>>)[0]
  assert.equal(snap.status, 'denied')
  assert.match(snap.denialReasonCode as string, /^[a-z0-9_]+$/)
  assert.ok(Array.isArray(snap.explanation) && (snap.explanation as unknown[]).length > 0)
})

test('an unsupported program comes back not_supported, not a 501 for the whole call', async () => {
  const res = await request(app)
    .post(URL)
    .send(eligibleHousehold({ programs: ['snap', 'tanf'] }))
  assert.equal(res.status, 200)
  const dets = res.body.determinations as Array<Record<string, unknown>>
  assert.equal(dets.find((d) => d.program === 'snap')!.status, 'approved')
  assert.equal(dets.find((d) => d.program === 'tanf')!.status, 'not_supported')
})

test('an empty body is a valid call', async () => {
  const res = await request(app).post(URL).send({})
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.determinations))
  // No metadata was sent, so none is echoed.
  assert.equal(res.body.metadata, undefined)
})

test('invalid asOf is a 400 Problem Details', async () => {
  const res = await request(app)
    .post(URL)
    .send(eligibleHousehold({ asOf: 'not-a-date' }))
  assert.equal(res.status, 400)
  assert.equal(res.body.status, 400)
})

test('response leaks no x- fields or Fact Graph paths', async () => {
  const res = await request(app).post(URL).send(eligibleHousehold())
  const text = JSON.stringify(res.body)
  assert.ok(!/"x-/.test(text), 'no x- overlay fields on the v2 surface')
  assert.ok(!text.includes('/members/') && !text.includes('/meets'), 'no Fact Graph paths')
})
