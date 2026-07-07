/**
 * v2 Medicaid eligibility — POST /v2/eligibility/medicaid/determination.
 * Per-member scope: one request, one determination per household member.
 * Covers basic shape, per-member missingInputs attribution, empty body, and
 * the no-x-/no-path discipline.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

import { app } from './helpers.js'

const URL = '/v2/eligibility/medicaid/determination'

/** Minimal member with enough to get an approved Adult determination. */
const adultMember = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  dateOfBirth: '1990-03-15',
  income: [{ type: 'wages_and_salaries', amount: 500, frequency: 'monthly' }],
  ...over,
})

/** Minimal child member — income zero so household FPL is low. */
const childMember = (id: string) => ({
  id,
  dateOfBirth: '2018-01-01',
  income: [{ type: 'wages_and_salaries', amount: 0, frequency: 'monthly' }],
})

// ---------------------------------------------------------------------------
// Shape and structure
// ---------------------------------------------------------------------------

test('returns one member-scoped determination per member', async () => {
  const res = await request(app).post(URL).send({
    metadata: { caseId: 'v2-medicaid-test' },
    members: [adultMember('head'), adultMember('spouse')],
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.metadata.caseId, 'v2-medicaid-test')
  const dets = res.body.determinations as Array<Record<string, unknown>>
  assert.equal(dets.length, 2, 'one determination per member')
  for (const det of dets) {
    assert.equal(det.scope, 'member')
    assert.ok(typeof det.memberId === 'string', 'memberId is a string')
    assert.equal(det.program, 'medicaid')
  }
})

test('memberId matches the caller-assigned id', async () => {
  const res = await request(app).post(URL).send({
    members: [{ id: 'alice-uuid-123', dateOfBirth: '1990-01-01' }],
  })
  assert.equal(res.status, 200)
  const det = res.body.determinations[0] as Record<string, unknown>
  assert.equal(det.memberId, 'alice-uuid-123')
})

test('empty body returns an empty determinations array (no members = no decisions)', async () => {
  const res = await request(app).post(URL).send({})
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.determinations, [], 'no members → no determinations')
  assert.equal(res.body.metadata, undefined)
})

// ---------------------------------------------------------------------------
// Approved path
// ---------------------------------------------------------------------------

test('approved adult — status, medicaidCategory, no missingInputs', async () => {
  const res = await request(app).post(URL).send({ members: [adultMember('alice')] })
  assert.equal(res.status, 200)
  const det = res.body.determinations[0] as Record<string, unknown>
  assert.equal(det.status, 'approved')
  assert.equal(det.path, 'auto')
  assert.ok(typeof det.medicaidCategory === 'string', 'medicaidCategory present on approved')
  assert.ok(!('missingInputs' in det), 'no missingInputs when approved')
  assert.ok(!('benefitAmount' in det), 'no benefitAmount on Medicaid (not a cash benefit)')
})

test('approved child — older_child category (snake_case wire value)', async () => {
  const res = await request(app).post(URL).send({ members: [childMember('bob')] })
  assert.equal(res.status, 200)
  const det = res.body.determinations[0] as Record<string, unknown>
  assert.equal(det.status, 'approved')
  assert.equal(det.medicaidCategory, 'older_child')
  assert.ok('chpEligible' in det, 'chpEligible present on approved')
})

test('two members with different incomes each get their own determination', async () => {
  const res = await request(app).post(URL).send({
    members: [adultMember('alice'), childMember('bob')],
  })
  assert.equal(res.status, 200)
  const dets = res.body.determinations as Array<Record<string, unknown>>
  assert.equal(dets.length, 2)

  const alice = dets.find((d) => d.memberId === 'alice')
  const bob = dets.find((d) => d.memberId === 'bob')
  assert.ok(alice && bob, 'both members present')
  assert.equal(alice.status, 'approved')
  assert.equal(bob.status, 'approved')
  assert.ok(alice.medicaidCategory !== bob.medicaidCategory, 'different categories for adult vs child')
})

// ---------------------------------------------------------------------------
// Ineligible path
// ---------------------------------------------------------------------------

test('ineligible member — denialReasonCode present, snake_case', async () => {
  const res = await request(app).post(URL).send({
    members: [adultMember('alice', {
      income: [{ type: 'wages_and_salaries', amount: 99999, frequency: 'monthly' }],
    })],
  })
  assert.equal(res.status, 200)
  const det = res.body.determinations[0] as Record<string, unknown>
  assert.equal(det.status, 'ineligible')
  assert.ok(typeof det.denialReasonCode === 'string', 'denialReasonCode present')
  assert.ok(!/[A-Z]/.test(det.denialReasonCode as string), 'denialReasonCode is snake_case')
  assert.ok(!('missingInputs' in det), 'no missingInputs when ineligible (decision is resolved)')
})

// ---------------------------------------------------------------------------
// Pending path and missingInputs
// ---------------------------------------------------------------------------

test('pending member — missingInputs in the friendly request vocabulary', async () => {
  // Member without income rows → engine cannot resolve; comes back pending.
  const res = await request(app).post(URL).send({
    members: [{ id: 'alice', dateOfBirth: '1990-01-01' }],
  })
  assert.equal(res.status, 200)
  const det = res.body.determinations[0] as Record<string, unknown>
  assert.equal(det.status, 'pending')
  const missing = det.missingInputs as Array<Record<string, unknown>>
  assert.ok(Array.isArray(missing) && missing.length > 0, 'missingInputs present')
  for (const m of missing) {
    assert.ok(typeof m.requestPath === 'string', 'requestPath present')
    assert.ok(!(m.requestPath as string).startsWith('/'), 'requestPath is friendly, not an engine path')
    assert.ok(typeof m.field === 'string', 'field present')
    assert.ok(m.kind === 'field' || m.kind === 'unacknowledged', 'kind present')
    assert.ok(Array.isArray(m.at), 'at address present')
    if (m.kind === 'field') {
      assert.ok(typeof m.label === 'string', 'label present on field entries')
      assert.ok(typeof m.location === 'string', 'location present on field entries')
    } else {
      assert.ok(typeof m.hint === 'string', 'hint present on unacknowledged entries')
    }
  }
})

test('per-member missingInputs — each member gets only their own unresolved fields', async () => {
  // head has dateOfBirth; spouse does not. Attribution should surface
  // dateOfBirth in spouse's missingInputs but not in head's.
  const res = await request(app).post(URL).send({
    members: [
      { id: 'head', dateOfBirth: '1990-01-01' },
      { id: 'spouse' },
    ],
  })
  assert.equal(res.status, 200)
  const dets = res.body.determinations as Array<Record<string, unknown>>

  const headDet = dets.find((d) => d.memberId === 'head')
  const spouseDet = dets.find((d) => d.memberId === 'spouse')
  assert.ok(headDet && spouseDet)

  const headFields = ((headDet.missingInputs ?? []) as Array<{ field: string }>).map((m) => m.field)
  const spouseFields = ((spouseDet.missingInputs ?? []) as Array<{ field: string }>).map((m) => m.field)

  assert.ok(!headFields.includes('dateOfBirth'), `head should not need dateOfBirth; got: ${headFields.join(', ')}`)
  assert.ok(spouseFields.includes('dateOfBirth'), `spouse should need dateOfBirth; got: ${spouseFields.join(', ')}`)
})

test('pending member — the unanswered income question appears in missingInputs', async () => {
  // Medicaid income is household-scoped: if NO member provides income rows,
  // the determination cannot resolve. The response asks the income QUESTION
  // (an `unacknowledged` entry — send rows or []) rather than listing the
  // fields of rows that don't exist yet.
  const res = await request(app).post(URL).send({
    members: [{ id: 'alice', dateOfBirth: '1990-01-01' }],
  })
  assert.equal(res.status, 200)
  const det = res.body.determinations[0] as Record<string, unknown>
  assert.equal(det.status, 'pending')
  const missing = (det.missingInputs ?? []) as Array<{
    kind: string
    field: string
    at: Array<{ in: string; id: string }>
  }>
  const incomeAsk = missing.find((m) => m.kind === 'unacknowledged' && m.field === 'income')
  assert.ok(incomeAsk, 'unacknowledged income question present')
  assert.deepEqual(incomeAsk!.at, [{ in: 'members', id: 'alice' }])
})

test('income: [] asserts no income — resolves without income fields in missingInputs', async () => {
  // income: [] (explicit empty) should be treated as "no income" and resolve,
  // unlike omitting the field which leaves income unknown (pending).
  const withEmpty = await request(app).post(URL).send({
    members: [{ id: 'alice', dateOfBirth: '1990-01-01', income: [] }],
  })
  const withAbsent = await request(app).post(URL).send({
    members: [{ id: 'alice', dateOfBirth: '1990-01-01' }],
  })
  assert.equal(withEmpty.status, 200)
  assert.equal(withAbsent.status, 200)

  const emptyDet  = withEmpty.body.determinations[0] as Record<string, unknown>
  const absentDet = withAbsent.body.determinations[0] as Record<string, unknown>

  assert.equal(emptyDet.status, 'approved', 'income: [] resolves to approved (zero household income)')
  assert.equal(absentDet.status, 'pending',  'omitted income stays pending')

  const incomeInEmpty = ((emptyDet.missingInputs ?? []) as Array<{ location: string }>)
    .filter((m) => m.location === 'members[].income[]').length
  assert.equal(incomeInEmpty, 0, 'income: [] — no income fields in missingInputs')
})

test('a member pending only on shared fields is not blamed for another member\'s gaps', async () => {
  // alice fully specifies her own member-level fields (dateOfBirth) but neither
  // member acknowledges income, so the household income is unknown and both are
  // pending on that shared field. bob is additionally missing dateOfBirth.
  // alice's per-member list must NOT include bob's member-level dateOfBirth.
  const res = await request(app).post(URL).send({
    members: [
      { id: 'alice', dateOfBirth: '1990-01-01' },
      { id: 'bob' },
    ],
  })
  assert.equal(res.status, 200)
  const dets = res.body.determinations as Array<Record<string, unknown>>
  const alice = dets.find((d) => d.memberId === 'alice')!
  const bob = dets.find((d) => d.memberId === 'bob')!
  assert.equal(alice.status, 'pending')
  assert.equal(bob.status, 'pending')

  const aliceFields = ((alice.missingInputs ?? []) as Array<{ field: string }>).map((m) => m.field)
  const bobFields = ((bob.missingInputs ?? []) as Array<{ field: string }>).map((m) => m.field)
  // alice provided her dateOfBirth; she must not be told to provide it again.
  assert.ok(!aliceFields.includes('dateOfBirth'), `alice should not need dateOfBirth; got: ${aliceFields.join(', ')}`)
  // the income question still surfaces for alice (she never acknowledged it).
  assert.ok(aliceFields.includes('income'), `alice should still owe the income question; got: ${aliceFields.join(', ')}`)
  // bob's own member-level gap is attributed to bob.
  assert.ok(bobFields.includes('dateOfBirth'), `bob should need dateOfBirth; got: ${bobFields.join(', ')}`)
})

// ---------------------------------------------------------------------------
// Validation and errors
// ---------------------------------------------------------------------------

test('invalid asOf is a 400 Problem Details', async () => {
  const res = await request(app).post(URL).send({
    asOf: 'not-a-date',
    members: [{ id: 'head' }],
  })
  assert.equal(res.status, 400)
  assert.equal(res.body.status, 400)
  assert.ok(typeof res.body.title === 'string')
})

// ---------------------------------------------------------------------------
// Surface discipline
// ---------------------------------------------------------------------------

test('response leaks no x- fields or Fact Graph paths', async () => {
  const res = await request(app).post(URL).send({ members: [adultMember('head')] })
  const text = JSON.stringify(res.body)
  assert.ok(!/"x-/.test(text), 'no x- overlay fields on the v2 surface')
  assert.ok(!text.includes('/members/*/') && !text.includes('/meets'), 'no Fact Graph paths')
})

test('metadata is echoed unchanged when provided', async () => {
  const meta = { caseId: 'xyz', source: 'test' }
  const res = await request(app).post(URL).send({ metadata: meta, members: [adultMember('a')] })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.metadata, meta)
})

test('metadata is absent when not sent', async () => {
  const res = await request(app).post(URL).send({ members: [adultMember('a')] })
  assert.equal(res.status, 200)
  assert.equal(res.body.metadata, undefined)
})

test('asOf is present in every response', async () => {
  const res = await request(app).post(URL).send({ members: [adultMember('a')] })
  assert.equal(res.status, 200)
  assert.ok(typeof res.body.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(res.body.asOf))
})
