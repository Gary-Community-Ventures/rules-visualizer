/**
 * Finality gate — determinations must not be final when the engine resolved
 * them THROUGH unknowns (skipped Switch cases, summed-past collection rows).
 *
 * Regression tests for the three confirmed false-definitive variants from
 * the 2026-07-07 audit:
 *   1. medicaid: age+income resolved, pregnant/receivesSsi unasked, income
 *      between the adult and pregnancy FPL limits → was a committed
 *      `ineligible` that flipped to approved on `pregnant: 1`;
 *   2. snap: over-income household with receivesTanf unasked → was a
 *      committed `denied` (failed_net_income_test) that flipped to approved
 *      via BCE on `receivesTanf: true`;
 *   3. medicaid: an income row carrying only an id was summed past → was a
 *      premature `approved` with zero missing inputs.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

import { app } from './helpers.js'
import { buildFriendlyRequest } from './snap-golden-fixture.js'

const SNAP_URL = '/v2/eligibility/snap/determination'
const MEDICAID_URL = '/v2/eligibility/medicaid/determination'

type Entry = {
  kind: string
  field: string
  requestPath: string
  at: Array<{ in: string; id: string }>
}

/** One adult, income ~159% FPL for a household of one (between the adult
 *  138% and pregnancy 200% limits), pregnancy/SSI questions unanswered. */
const BETWEEN_LIMITS_MEMBER = {
  id: 'alice',
  dateOfBirth: '1990-03-15',
  // pregnant / pregnancyEndDate / receivesSsi deliberately unanswered
  income: [{ id: 'pay-1', type: 'wages_and_salaries', amount: 2000, frequency: 'monthly' }],
}

/** The answers that settle every category/work/legal question for an adult.
 *  The medicaid ruleset is no-guess end to end, so a final determination
 *  requires all of them. */
const FULL_ANSWERS = {
  pregnant: 0,
  pregnancyEndDate: '2000-01-01',
  receivesSsi: false,
  disabled: false,
  veteran: false,
  hasDisabledChild: false,
  isFullTimeStudent: false,
  monthlyHoursWorked: 80,
  immigrantStatus: 'citizen',
}

test('variant 1 — medicaid: category default over unanswered pregnancy is pending, not ineligible', async () => {
  const res = await request(app)
    .post(MEDICAID_URL)
    .send({ members: [BETWEEN_LIMITS_MEMBER] })
  assert.equal(res.status, 200)
  const det = res.body.determinations[0]

  assert.equal(det.status, 'pending', 'unanswered category questions withhold finality')
  assert.equal(det.denialReasonCode, undefined)
  assert.equal(det.medicaidCategory, undefined, 'artifact category suppressed')

  const fields = (det.missingInputs as Entry[]).map((m) => m.field)
  assert.ok(fields.includes('pregnant'), `pregnant is asked; got: ${fields.join(', ')}`)
  assert.ok(fields.includes('receivesSsi'), `receivesSsi is asked; got: ${fields.join(', ')}`)

  // Answering the skipped questions produces a REAL determination.
  const answered = await request(app)
    .post(MEDICAID_URL)
    .send({
      members: [
        { ...BETWEEN_LIMITS_MEMBER, ...FULL_ANSWERS, pregnant: 1, pregnancyEndDate: '2026-01-01' },
      ],
    })
  assert.equal(answered.body.determinations[0].status, 'approved', 'pregnancy category applies')
})

test('variant 1b — answering the questions negatively yields a real, final ineligible', async () => {
  const res = await request(app)
    .post(MEDICAID_URL)
    .send({ members: [{ ...BETWEEN_LIMITS_MEMBER, ...FULL_ANSWERS }] })
  assert.equal(res.status, 200)
  const det = res.body.determinations[0]
  assert.equal(det.status, 'ineligible', 'fully-supported denial stands')
  assert.equal(det.denialReasonCode, 'not_in_eligible_category')
})

test('variant 2 — snap: denial that a TANF answer could overturn is pending, not denied', async () => {
  const req = buildFriendlyRequest({ incomeAmount: 99999 }) as {
    members: Array<Record<string, unknown>>
  }
  for (const m of req.members) delete m.receivesTanf

  const res = await request(app).post(SNAP_URL).send(req)
  assert.equal(res.status, 200)
  const det = res.body.determinations[0]

  assert.equal(det.status, 'pending', 'the skipped BCE tier withholds finality')
  assert.equal(det.denialReasonCode, undefined)
  assert.equal(det.benefitAmount, undefined, 'no numbers on a conditional determination')

  const entries = det.missingInputs as Entry[]
  const tanf = entries.filter((m) => m.field === 'receivesTanf')
  assert.ok(tanf.length > 0, `receivesTanf is asked; got: ${entries.map((m) => m.field).join(', ')}`)
  assert.ok(
    tanf.every((m) => m.at[0]?.in === 'members'),
    'asked per member, addressed by at'
  )

  // Answered false → the denial is real and final again.
  const denied = await request(app)
    .post(SNAP_URL)
    .send(buildFriendlyRequest({ incomeAmount: 99999 }))
  const deniedDet = denied.body.determinations[0]
  assert.equal(deniedDet.status, 'denied', 'fully-supported denial stands')
  assert.match(String(deniedDet.denialReasonCode), /failed_(gross|net)_income_test/)
})

test('variant 3 — medicaid: an income row the engine summed past withholds finality', async () => {
  const res = await request(app)
    .post(MEDICAID_URL)
    .send({
      members: [
        {
          ...BETWEEN_LIMITS_MEMBER,
          ...FULL_ANSWERS,
          income: [
            { id: 'pay-1', type: 'wages_and_salaries', amount: 100, frequency: 'monthly' },
            { id: 'pay-2' }, // amount/type/frequency unknown — engine sums past it
          ],
        },
      ],
    })
  assert.equal(res.status, 200)
  const det = res.body.determinations[0]

  assert.equal(det.status, 'pending', 'a summed-past row withholds finality')
  const entries = det.missingInputs as Entry[]
  const rowAmount = entries.find(
    (m) => m.requestPath === 'members[].income[].amount' && m.at[1]?.id === 'pay-2'
  )
  assert.ok(
    rowAmount,
    `the incomplete row's amount is asked with a row address; got: ${JSON.stringify(entries.map((m) => ({ f: m.field, at: m.at })))}`
  )
})

test('goldens are not disturbed: complete inputs still decide finally', async () => {
  const approved = await request(app).post(SNAP_URL).send(buildFriendlyRequest())
  assert.equal(approved.body.determinations[0].status, 'approved')

  const medicaid = await request(app)
    .post(MEDICAID_URL)
    .send({ members: [{ ...BETWEEN_LIMITS_MEMBER, ...FULL_ANSWERS, income: [{ id: 'pay-1', type: 'wages_and_salaries', amount: 100, frequency: 'monthly' }] }] })
  assert.equal(medicaid.body.determinations[0].status, 'approved')
})

test('/query exposes conditionalTargets and counts conditional targets as incomplete', async () => {
  const res = await request(app)
    .post('/v1/factgraph/medicaid/query')
    .send({
      targets: ['/members/*/medicaid'],
      inputs: {
        '/members': [{ id: 'alice', '/members/*/age': 35 }],
        '/incomes': [
          {
            id: 'pay-1',
            '/incomes/*/memberId': '#0',
            '/incomes/*/type': 'WagesAndSalaries',
            '/incomes/*/amount': 2000,
            '/incomes/*/frequency': 'Monthly',
          },
        ],
      },
    })
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'incomplete', 'conditional resolution is not complete')
  const groups = res.body.conditionalTargets?.['/members/*/medicaid']
  assert.ok(Array.isArray(groups) && groups.length > 0, 'conditionalTargets names the target')
  assert.equal(groups[0].memberId, 'alice', 'conditionality attributed to the member')
  assert.ok(
    (res.body.missingInputs as Array<{ path: string }>).some((m) => m.path === '/members/*/pregnant'),
    'the skipped question is in missingInputs'
  )
})
