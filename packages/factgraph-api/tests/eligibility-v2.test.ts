/**
 * v2 eligibility surface — POST /v2/eligibility/evaluate/determination.
 * The endpoint takes the friendly request DTO, translates it no-guess (only
 * provided fields), runs each program, and returns a unified determinations[]
 * with missingInputs in the same friendly vocabulary. Covers multi-program
 * dispatch, the household-vs-member scope split, no-guess pending + friendly
 * missingInputs, unsupported programs, the empty call, and the no-x-/no-paths
 * discipline.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

import { app } from './helpers.js'

const URL = '/v2/eligibility/evaluate/determination'

/** A partial-but-valid friendly request: demographics + income, nothing else.
 *  Under no-guess this resolves Medicaid (needs little) and leaves SNAP pending
 *  (needs many more facts). */
const friendlyRequest = (over: Record<string, unknown> = {}) => ({
  metadata: { caseId: 'v2-demo' },
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

test('runs every supported program by default, unified determinations[]', async () => {
  const res = await request(app).post(URL).send(friendlyRequest())
  assert.equal(res.status, 200)
  assert.equal(res.body.metadata.caseId, 'v2-demo')
  const dets = res.body.determinations as Array<Record<string, unknown>>

  const snap = dets.find((d) => d.program === 'snap')
  assert.ok(snap, 'expected a snap determination')
  assert.equal(snap!.scope, 'household')
  // No-guess: with only demographics + income, SNAP can't resolve.
  assert.equal(snap!.status, 'pending')

  const medicaid = dets.filter((d) => d.program === 'medicaid')
  assert.ok(medicaid.length >= 1, 'expected per-member medicaid determinations')
  assert.equal(medicaid[0].scope, 'member')
  assert.equal(medicaid[0].memberId, 'head')
})

test('a pending determination lists missingInputs in the friendly request vocabulary', async () => {
  const res = await request(app).post(URL).send(friendlyRequest({ programs: ['snap'] }))
  const snap = (res.body.determinations as Array<Record<string, unknown>>)[0]
  assert.equal(snap.status, 'pending')
  const missing = snap.missingInputs as Array<Record<string, unknown>>
  assert.ok(Array.isArray(missing) && missing.length > 0, 'expected missingInputs')
  for (const m of missing) {
    assert.ok(typeof m.requestPath === 'string' && m.requestPath.length > 0)
    assert.ok(typeof m.field === 'string' && !(m.field as string).includes('/'))
    assert.ok(typeof m.location === 'string', 'has a location')
    assert.ok(typeof m.label === 'string', 'has a human label')
    // Never a raw Fact Graph path.
    assert.ok(!(m.requestPath as string).startsWith('/'), 'requestPath is friendly, not a path')
  }
})

test('programs filter runs only what was asked', async () => {
  const res = await request(app).post(URL).send(friendlyRequest({ programs: ['snap'] }))
  const programs = new Set(
    (res.body.determinations as Array<{ program: string }>).map((d) => d.program)
  )
  assert.deepEqual([...programs], ['snap'])
})

test('an unsupported program comes back not_supported, not a 501 for the whole call', async () => {
  const res = await request(app).post(URL).send(friendlyRequest({ programs: ['snap', 'tanf'] }))
  assert.equal(res.status, 200)
  const dets = res.body.determinations as Array<Record<string, unknown>>
  assert.ok(dets.find((d) => d.program === 'snap'), 'snap still runs')
  assert.equal(dets.find((d) => d.program === 'tanf')!.status, 'not_supported')
})

test('an empty body is a valid call', async () => {
  const res = await request(app).post(URL).send({})
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.determinations))
  assert.equal(res.body.metadata, undefined) // none sent, none echoed
})

test('invalid asOf is a 400 Problem Details', async () => {
  const res = await request(app).post(URL).send(friendlyRequest({ asOf: 'not-a-date' }))
  assert.equal(res.status, 400)
  assert.equal(res.body.status, 400)
})

test('response leaks no x- fields or Fact Graph paths', async () => {
  const res = await request(app).post(URL).send(friendlyRequest())
  const text = JSON.stringify(res.body)
  assert.ok(!/"x-/.test(text), 'no x- overlay fields on the v2 surface')
  assert.ok(!text.includes('/members/*/') && !text.includes('/meets'), 'no Fact Graph paths')
})
