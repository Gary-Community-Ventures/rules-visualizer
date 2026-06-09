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
          {
            type: 'employed',
            amount: 1200,
            frequency: 'monthly',
            incomeBasis: 'gross',
          },
        ],
        expenses: [{ category: 'housing', amount: 800, frequency: 'monthly' }],
        assets: [
          { type: 'liquid', value: 500, description: 'checking account' },
        ],
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
  const res = await request(app)
    .post(DETERMINATION_URL)
    .send(householdRequest())
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
  const metadata = {
    applicationId: 'echo-me',
    nested: { a: 1 },
    traceId: 'xyz',
  }
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

test('SNAP over-income → denied, snake_case reason code, path-free explanation', async () => {
  // Push wages well over the gross-income limit for a household of 1.
  const req = householdRequest()
  req.members[0].income = [
    {
      type: 'employed',
      amount: 9000,
      frequency: 'monthly',
      incomeBasis: 'gross',
    },
  ]
  const res = await request(app).post(DETERMINATION_URL).send(req)
  assert.equal(res.status, 200)
  // Failed financial test → denied (appealable), not ineligible (categorical).
  assert.equal(res.body.status, 'denied')
  // snake_case, no SCREAMING_CASE, per Worker Portal conventions.
  assert.match(res.body.denialReasonCode, /^[a-z0-9_]+$/)
  // Path-free domain-summarized explanation; no Fact Graph paths or x-trace.
  assert.ok(Array.isArray(res.body['x-explanation']), 'expected x-explanation')
  assert.equal(res.body['x-decidingPath'], undefined)
  assert.equal(res.body['x-trace'], undefined)
  const serialized = JSON.stringify(res.body)
  assert.ok(
    !serialized.includes('/members/') && !serialized.includes('/meets'),
    'response must not leak Fact Graph paths'
  )
})

test('determination for an unsupported program (chip) → 501', async () => {
  const res = await request(app)
    .post(DETERMINATION_URL)
    .send(householdRequest({ program: 'chip' }))
  assert.equal(res.status, 501)
  assert.equal(res.body.status, 501)
})

// ---------------------------------------------------------------------------
// Medicaid determination (household-in, per-member-out)
// ---------------------------------------------------------------------------

test('medicaid determination returns one decision per member', async () => {
  const body = {
    metadata: { applicationId: 'm-1' },
    program: 'medicaid',
    household: { size: 3 },
    members: [
      {
        id: 'mom',
        dateOfBirth: '1990-01-01',
        citizenshipStatus: 'us_citizen',
        income: [{ type: 'employed', amount: 1500, frequency: 'monthly' }],
      },
      { id: 'baby', dateOfBirth: '2025-06-01', citizenshipStatus: 'us_citizen' },
      { id: 'gran', dateOfBirth: '1950-01-01', citizenshipStatus: 'us_citizen' },
    ],
    verificationSummary: [],
  }
  const res = await request(app).post(DETERMINATION_URL).send(body)
  assert.equal(res.status, 200)
  assert.equal(res.body.program, 'medicaid')
  assert.deepEqual(res.body.metadata, { applicationId: 'm-1' })
  // One decision per member, correlated by the caller's member id.
  assert.equal(res.body.decisions.length, 3)
  assert.deepEqual(
    res.body.decisions.map((d: { memberId: string }) => d.memberId),
    ['mom', 'baby', 'gran']
  )
  const baby = res.body.decisions.find(
    (d: { memberId: string }) => d.memberId === 'baby'
  )
  assert.equal(baby.status, 'approved')
  assert.match(baby['x-medicaidCategory'], /Child|Infant/)
})

test('medicaid SSI is derived from unearned income type', async () => {
  const body = {
    program: 'medicaid',
    household: { size: 1 },
    members: [
      {
        id: 'a',
        dateOfBirth: '1960-01-01',
        citizenshipStatus: 'us_citizen',
        income: [
          {
            type: 'unearned',
            unearnedType: 'ssi_or_ssdi',
            amount: 900,
            frequency: 'monthly',
          },
        ],
      },
    ],
  }
  const res = await request(app).post(DETERMINATION_URL).send(body)
  assert.equal(res.status, 200)
  const d = res.body.decisions[0]
  assert.equal(d['x-medicaidCategory'], 'SsiRecipient')
  assert.ok(
    (res.body['x-translationNotes'] as string[]).some((n) => /SSI/.test(n))
  )
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
  const res = await request(app)
    .post(EXPEDITED_URL)
    .send({ household: { size: 1 } })
  assert.equal(res.status, 400)
})
