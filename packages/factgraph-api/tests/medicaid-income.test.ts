/**
 * Verifies the Medicaid ruleset's itemized-income calculation: each income row
 * is annualized by its frequency and classified earned/unearned, then summed
 * into the (now derived) /earnedIncome and /unearnedIncome the MAGI test uses.
 * This is the unit-correctness check for the income subsystem added to
 * data/factgraph/medicaid/medicaid.xml.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import { getRuleset, getRawFacts } from 'rules-visualizer-factgraph-core'

import { app } from './helpers.js'
import { runQuery } from '../src/evaluate.js'

/** Pull an enum fact's options out of a ruleset's model. */
function enumOptions(rulesetId: string, path: string): string[] {
  const m = getRuleset(rulesetId)!
  const node = (Object.values(m.nodes) as Array<{ content: { path?: string; enumOptions?: string[] } }>).find(
    (n) => n.content.path === path
  )
  return node?.content.enumOptions ?? []
}

const model = getRuleset('medicaid')!
const facts = getRawFacts('medicaid')!

function totals(incomes: Array<Record<string, unknown>>) {
  const r = runQuery('medicaid', model, facts, {
    targets: ['/earnedIncome', '/unearnedIncome'],
    inputs: { '/members': [{ id: 'head', '/members/*/age': 30 }], '/incomes': incomes },
  })
  assert.ok(r.ok, 'targets resolve')
  assert.equal(r.response.status, 'complete', 'income fully resolves')
  return r.response.values
}

const row = (type: string, amount: number, frequency: string) => ({
  id: `${type}-${amount}-${frequency}`,
  '/incomes/*/memberId': '#0',
  '/incomes/*/type': type,
  '/incomes/*/amount': amount,
  '/incomes/*/frequency': frequency,
})

test('annualizes by frequency and splits earned vs unearned', () => {
  const v = totals([
    row('WagesAndSalaries', 1000, 'Monthly'), // earned: 1000 × 12 = 12,000
    row('SelfEmployment', 100, 'Weekly'), //     earned: 100 × 52 = 5,200
    row('Ssi', 500, 'Monthly'), //               unearned: 500 × 12 = 6,000
  ])
  assert.equal(v['/earnedIncome'], 17_200)
  assert.equal(v['/unearnedIncome'], 6_000)
})

test('each frequency annualizes with the right multiplier', () => {
  // 100 at each frequency, all unearned (Ssi), summed annual:
  // Monthly 1200 + Weekly 5200 + BiWeekly 2600 + SemiMonthly 2400 + Annual 100
  const v = totals([
    row('Ssi', 100, 'Monthly'),
    row('Ssi', 100, 'Weekly'),
    row('Ssi', 100, 'BiWeekly'),
    row('Ssi', 100, 'SemiMonthly'),
    row('Ssi', 100, 'Annual'),
  ])
  assert.equal(v['/unearnedIncome'], 1_200 + 5_200 + 2_600 + 2_400 + 100)
  assert.equal(v['/earnedIncome'], 0)
})

test('an empty income list yields zero, not undefined', () => {
  const v = totals([])
  assert.equal(v['/earnedIncome'], 0)
  assert.equal(v['/unearnedIncome'], 0)
})

test('boarder income counts as earned (mirrors SNAP classification)', () => {
  const v = totals([row('BoarderIncome', 200, 'Monthly'), row('Loans', 200, 'Monthly')])
  assert.equal(v['/earnedIncome'], 2_400) // boarder income is earned
  assert.equal(v['/unearnedIncome'], 2_400) // loans are unearned
})

// The income source/frequency vocab is duplicated into the Medicaid ruleset
// (the two rulesets load independently). Guard against silent drift: if SNAP's
// vocabulary changes, Medicaid's copy must change too, or this fails.
test('Medicaid income vocab stays in lockstep with SNAP', () => {
  assert.deepEqual(
    enumOptions('medicaid', '/incomeSourceOptions'),
    enumOptions('snap-complete', '/incomeSourceOptions'),
    'income source options drifted between Medicaid and SNAP'
  )
  assert.deepEqual(
    enumOptions('medicaid', '/incomeFrequencyOptions'),
    enumOptions('snap-complete', '/incomeFrequencyOptions'),
    'income frequency options drifted between Medicaid and SNAP'
  )
})

// End-to-end: the corrected (annual) income must actually drive the MAGI
// determination — clearly-over-income lands Ineligible, clearly-under stays in
// an income-eligible category. (Under the old monthly-into-annual bug, $60k/yr
// read as $5k/yr and looked income-eligible.)
const medicaidRequest = (monthlyWages: number) => ({
  metadata: {},
  program: 'medicaid',
  household: { size: 1 },
  members: [
    {
      id: 'head',
      dateOfBirth: '1990-01-01',
      citizenshipStatus: 'us_citizen',
      income: [{ type: 'employed', amount: monthlyWages, frequency: 'monthly' }],
    },
  ],
})

test('annual income drives the MAGI category (over FPL → Ineligible)', async () => {
  const over = await request(app)
    .post('/v1/eligibility/evaluate/determination')
    .send(medicaidRequest(5000)) // $60,000/yr — well over the annual FPL
  assert.equal(over.status, 200)
  assert.equal(over.body.decisions[0]['x-medicaidCategory'], 'Ineligible')

  const under = await request(app)
    .post('/v1/eligibility/evaluate/determination')
    .send(medicaidRequest(500)) // $6,000/yr — income-eligible (Adult)
  assert.equal(under.body.decisions[0]['x-medicaidCategory'], 'Adult')
})
