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

test('approved child — OlderChild category', async () => {
  const res = await request(app).post(URL).send({ members: [childMember('bob')] })
  assert.equal(res.status, 200)
  const det = res.body.determinations[0] as Record<string, unknown>
  assert.equal(det.status, 'approved')
  assert.equal(det.medicaidCategory, 'OlderChild')
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
    assert.ok(typeof m.label === 'string', 'label present')
    assert.ok(typeof m.location === 'string', 'location present')
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

test('pending member — income fields appear in missingInputs when no household income provided', async () => {
  // Medicaid income is household-scoped: if NO member provides income rows,
  // the determination cannot resolve and income fields appear in missingInputs.
  const res = await request(app).post(URL).send({
    members: [{ id: 'alice', dateOfBirth: '1990-01-01' }],
  })
  assert.equal(res.status, 200)
  const det = res.body.determinations[0] as Record<string, unknown>
  assert.equal(det.status, 'pending')
  const missing = (det.missingInputs ?? []) as Array<{ field: string }>
  assert.ok(missing.some((m) => m.field === 'amount'), 'income amount in missingInputs when no income rows provided')
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
