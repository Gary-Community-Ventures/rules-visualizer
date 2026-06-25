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

test('missingInputsByMember attributes member-level fields to specific members', async () => {
  // Alice provides citizenship; Bob does not. Per-member breakdown should show
  // citizenship missing only for Bob, not Alice.
  const res = await request(app).post(URL).send({
    members: [
      { id: 'alice', dateOfBirth: '1990-01-01', citizenshipImmigrationStatus: 'citizen' },
      { id: 'bob',   dateOfBirth: '1985-06-15' },
    ],
    household: { applicationFilingDate: '2026-06-25' },
  })
  assert.equal(res.status, 200)
  const det = res.body.determinations[0] as Record<string, unknown>
  const byMember = det.missingInputsByMember as Record<string, Array<Record<string, unknown>>>
  assert.ok(byMember && typeof byMember === 'object', 'missingInputsByMember present')
  assert.ok('alice' in byMember && 'bob' in byMember, 'both member ids present')
  const aliceCitizenship = byMember.alice?.some((m) => m.field === 'citizenshipImmigrationStatus')
  const bobCitizenship = byMember.bob?.some((m) => m.field === 'citizenshipImmigrationStatus')
  assert.ok(!aliceCitizenship, 'alice provided citizenship — not in her list')
  assert.ok(bobCitizenship, 'bob did not provide citizenship — in his list')
  // All entries use friendly paths, not engine paths.
  for (const entries of Object.values(byMember)) {
    for (const m of entries) {
      assert.ok(!(m.requestPath as string).startsWith('/'), 'requestPath is friendly')
    }
  }
})

test('missingInputsByMember is absent when no members are sent', async () => {
  const res = await request(app).post(URL).send({})
  assert.equal(res.status, 200)
  const det = res.body.determinations[0] as Record<string, unknown>
  assert.ok(!('missingInputsByMember' in det), 'no byMember when no members provided')
})

// ---------------------------------------------------------------------------
// Sub-collection (income, expenses) attribution
// ---------------------------------------------------------------------------

test('income row with a missing field is attributed to the member who owns that row', async () => {
  // Alice sends an income row but omits `amount`. Bob sends no income rows.
  // Only Alice should have `amount` in her per-member list; Bob should not,
  // because the missing income amount is not specifically attributable to him.
  const res = await request(app).post(URL).send({
    members: [
      { id: 'alice', dateOfBirth: '1990-01-01',
        income: [{ type: 'wages_and_salaries', frequency: 'monthly' }] },
      { id: 'bob', dateOfBirth: '1985-06-15' },
    ],
  })
  assert.equal(res.status, 200)
  const det = res.body.determinations[0] as Record<string, unknown>
  const byMember = det.missingInputsByMember as Record<string, Array<Record<string, unknown>>>
  assert.ok(byMember, 'missingInputsByMember present')

  const aliceFields = (byMember.alice ?? []).map((m) => m.field as string)
  const bobFields   = (byMember.bob   ?? []).map((m) => m.field as string)
  assert.ok(aliceFields.includes('amount'), 'alice: income amount missing in her list')
  assert.ok(!bobFields.includes('amount'), 'bob: income amount not in his list (no income rows)')

  // The household-level union should still surface amount so the caller knows
  // the overall request is incomplete.
  const topLevel = (det.missingInputs as Array<Record<string, unknown>> ?? [])
  const topLevelHasAmount = topLevel.some((m) => m.field === 'amount')
  assert.ok(topLevelHasAmount, 'top-level missingInputs still includes amount')
})

test('complete income row produces no income fields in that member\'s per-member list', async () => {
  // Alice provides a fully-populated income row; Bob has no income rows.
  // Neither should have income fields in their per-member list.
  const res = await request(app).post(URL).send({
    members: [
      { id: 'alice', dateOfBirth: '1990-01-01',
        income: [{ type: 'wages_and_salaries', amount: 1200, frequency: 'monthly' }] },
      { id: 'bob', dateOfBirth: '1985-06-15' },
    ],
  })
  assert.equal(res.status, 200)
  const det = res.body.determinations[0] as Record<string, unknown>
  const byMember = det.missingInputsByMember as Record<string, Array<Record<string, unknown>>> | undefined

  const incomeFields = ['amount', 'type', 'frequency']
  for (const [memberId, entries] of Object.entries(byMember ?? {})) {
    const fields = entries.map((m) => m.field as string)
    const leaked = fields.filter((f) => incomeFields.includes(f))
    assert.deepEqual(leaked, [], `${memberId}: no income fields in per-member list when income is complete`)
  }
})

test('two members with different income gaps each receive their own attribution', async () => {
  // Alice: income row missing `amount`. Bob: income row missing `type` and `frequency`.
  // Each member's per-member list should reflect only their own gap.
  const res = await request(app).post(URL).send({
    members: [
      { id: 'alice', dateOfBirth: '1990-01-01',
        income: [{ type: 'wages_and_salaries', frequency: 'monthly' }] },  // missing: amount
      { id: 'bob', dateOfBirth: '1985-06-15',
        income: [{ amount: 800 }] },                                       // missing: type, frequency
    ],
  })
  assert.equal(res.status, 200)
  const det = res.body.determinations[0] as Record<string, unknown>
  const byMember = det.missingInputsByMember as Record<string, Array<Record<string, unknown>>>
  assert.ok(byMember?.alice && byMember?.bob, 'both members present in byMember')

  const aliceFields = byMember.alice.map((m) => m.field as string)
  const bobFields   = byMember.bob.map((m) => m.field as string)

  assert.ok(aliceFields.includes('amount'),    'alice: amount missing')
  assert.ok(!aliceFields.includes('type'),     'alice: type provided — not in her list')
  assert.ok(!aliceFields.includes('frequency'),'alice: frequency provided — not in her list')

  assert.ok(!bobFields.includes('amount'),     'bob: amount provided — not in his list')
  assert.ok(bobFields.includes('type'),        'bob: type missing')
  assert.ok(bobFields.includes('frequency'),   'bob: frequency missing')
})

test('expense row attribution follows the same logic as income rows', async () => {
  // Alice has an expense row missing `amount`; Bob has no expense rows.
  const res = await request(app).post(URL).send({
    members: [
      { id: 'alice', dateOfBirth: '1990-01-01',
        expenses: [{ type: 'shelter' }] },  // missing: amount
      { id: 'bob', dateOfBirth: '1985-06-15' },
    ],
  })
  assert.equal(res.status, 200)
  const det = res.body.determinations[0] as Record<string, unknown>
  const byMember = det.missingInputsByMember as Record<string, Array<Record<string, unknown>>>
  assert.ok(byMember, 'missingInputsByMember present')

  const aliceFields = (byMember.alice ?? []).map((m) => m.field as string)
  const bobFields   = (byMember.bob   ?? []).map((m) => m.field as string)
  assert.ok(aliceFields.includes('amount'), 'alice: expense amount in her per-member list')
  assert.ok(!bobFields.includes('amount'),  'bob: expense amount not attributed (no expense rows)')
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
