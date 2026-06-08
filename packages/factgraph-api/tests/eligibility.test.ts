/**
 * Eligibility adapter endpoint tests.
 *
 * Exercises the domain-oriented `/v1/eligibility/evaluate/*` wrappers
 * against `snap-complete` — the ORCA request shape in, the contract's
 * ProgramDecision / ExpeditedScreeningResponse out. The canonical
 * applicant (single 35-year-old, $1,200/mo wages, $800/mo rent, $500
 * checking) is the same scenario verified in docs/examples-snap.md and
 * docs/bruno/12-snap-complete-eligible.bru: ECE → approved, not expedited.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

import { app } from './helpers.js'

const EXPEDITED_URL = '/v1/eligibility/evaluate/expedited-screening'
const DETERMINATION_URL = '/v1/eligibility/evaluate/determination'
const MEDICAID_EX_PARTE_URL = '/v1/eligibility/evaluate/medicaid-ex-parte'

/** Canonical single working applicant (HouseholdDeterminationRequest). */
function householdRequest(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { applicationId: 'case-1234', traceId: 'req-abc' },
    program: 'snap',
    household: { size: 1 },
    members: [
      {
        id: 'head',
        dateOfBirth: '1990-03-15',
        citizenshipStatus: 'us_citizen',
        relationshipToHead: 'head_of_household',
        isDisabled: false,
        programs: ['snap'],
        income: [
          { type: 'employed', amount: 1200, frequency: 'monthly', incomeBasis: 'gross' },
        ],
        expenses: [{ category: 'housing', amount: 800, frequency: 'monthly' }],
        assets: [{ type: 'liquid', value: 500, description: 'checking account' }],
      },
    ],
    verificationSummary: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Determination
// ---------------------------------------------------------------------------

test('SNAP determination — canonical applicant → approved ProgramDecision', async () => {
  const res = await request(app).post(DETERMINATION_URL).send(householdRequest())
  assert.equal(res.status, 200)
  assert.equal(res.body.program, 'snap')
  assert.equal(res.body.status, 'approved')
  assert.equal(res.body.path, 'auto')
  assert.equal(res.body.denialReasonCode, undefined)
  // Overlay extensions carry the benefit numbers without polluting the
  // contract's base fields. ECE with a positive allotment; not expedited
  // (income and resources are above the 7 CFR §273.2(i) thresholds).
  assert.ok(
    typeof res.body['x-allotment'] === 'number' && res.body['x-allotment'] > 0,
    `expected a positive allotment, got ${res.body['x-allotment']}`
  )
  assert.ok(typeof res.body['x-proratedAllotment'] === 'number')
  assert.equal(res.body['x-expedited'], false)
})

test('SNAP determination echoes metadata unchanged (adapter passthrough rule)', async () => {
  const metadata = { applicationId: 'echo-me', nested: { a: 1 }, traceId: 'xyz' }
  const res = await request(app)
    .post(DETERMINATION_URL)
    .send(householdRequest({ metadata }))
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.metadata, metadata)
})

test('SNAP determination surfaces translation notes when flags were defaulted', async () => {
  // citizenshipStatus has no mapping for this value → defaulted + noted.
  const res = await request(app)
    .post(DETERMINATION_URL)
    .send(
      householdRequest({
        members: [
          {
            ...householdRequest().members[0],
            citizenshipStatus: 'some_unmapped_status',
          },
        ],
      })
    )
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body['x-translationNotes']))
  assert.ok(
    (res.body['x-translationNotes'] as string[]).some((n) =>
      n.includes('some_unmapped_status')
    ),
    'expected a note about the unmapped citizenship value'
  )
})

test('SNAP determination with trace → denialReasonCode + x-decidingPath when denied', async () => {
  // Push wages well over the gross-income limit for a household of 1.
  const req = householdRequest()
  req.members[0].income = [
    { type: 'employed', amount: 9000, frequency: 'monthly', incomeBasis: 'gross' },
  ]
  ;(req as Record<string, unknown>).include = ['trace']
  const res = await request(app).post(DETERMINATION_URL).send(req)
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'denied')
  assert.ok(typeof res.body.denialReasonCode === 'string')
  assert.ok(res.body['x-decidingPath'], 'expected x-decidingPath when trace requested')
})

test('determination for an unsupported per-member program → 501', async () => {
  const res = await request(app)
    .post(DETERMINATION_URL)
    .send(householdRequest({ program: 'medicaid' }))
  assert.equal(res.status, 501)
  assert.equal(res.body.status, 501)
  assert.match(res.body.detail, /medicaid/)
})

test('determination for an unknown program → 400', async () => {
  const res = await request(app)
    .post(DETERMINATION_URL)
    .send(householdRequest({ program: 'banana' }))
  assert.equal(res.status, 400)
})

test('determination with no program → 400', async () => {
  const res = await request(app).post(DETERMINATION_URL).send({ members: [] })
  assert.equal(res.status, 400)
})

// ---------------------------------------------------------------------------
// Expedited screening
// ---------------------------------------------------------------------------

test('expedited screening — canonical applicant is not expedited', async () => {
  const res = await request(app).post(EXPEDITED_URL).send(householdRequest())
  assert.equal(res.status, 200)
  assert.equal(res.body.expedited, false)
  assert.deepEqual(res.body.metadata, {
    applicationId: 'case-1234',
    traceId: 'req-abc',
  })
})

test('expedited screening — destitute applicant qualifies', async () => {
  // Zero income, zero assets → at/below the 7 CFR §273.2(i) thresholds.
  const req = householdRequest()
  req.members[0].income = []
  req.members[0].assets = []
  const res = await request(app).post(EXPEDITED_URL).send(req)
  assert.equal(res.status, 200)
  assert.equal(res.body.expedited, true)
})

test('expedited screening defaults metadata to {} when absent', async () => {
  const req = householdRequest()
  delete (req as Record<string, unknown>).metadata
  const res = await request(app).post(EXPEDITED_URL).send(req)
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.metadata, {})
})

// ---------------------------------------------------------------------------
// Medicaid ex parte (stubbed)
// ---------------------------------------------------------------------------

test('medicaid ex parte → 501 not supported', async () => {
  const res = await request(app)
    .post(MEDICAID_EX_PARTE_URL)
    .send({ metadata: {}, program: 'medicaid', member: { id: 'a' } })
  assert.equal(res.status, 501)
  assert.match(res.body.detail, /ex parte/i)
})

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('expedited screening with no members → 400', async () => {
  const res = await request(app).post(EXPEDITED_URL).send({ household: { size: 1 } })
  assert.equal(res.status, 400)
})
