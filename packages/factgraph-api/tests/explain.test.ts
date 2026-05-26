/**
 * End-to-end trace coverage. Drives the API with realistic SNAP
 * scenarios and asserts the trace tree exposes the right shape,
 * deciding-branch semantics, and concrete leaf values.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

import {
  app,
  RULESET_ID,
  APPLICANT_ROW,
  ZEROED_SCALARS,
} from './helpers.js'

type TraceNode = {
  path?: string
  name?: string
  op: string
  value: unknown
  reason: string
  children?: TraceNode[]
  citations?: { sectionId: string; documentTitle: string }[]
}

const QUERY_URL = `/v1/factgraph/${RULESET_ID}/query`

/** Walk a trace looking for the first node whose `path` matches. */
function findByPath(node: TraceNode | undefined, path: string): TraceNode | undefined {
  if (!node) return undefined
  if (node.path === path) return node
  for (const c of node.children ?? []) {
    const found = findByPath(c, path)
    if (found) return found
  }
  return undefined
}

test('trace is omitted by default', async () => {
  const res = await request(app)
    .post(QUERY_URL)
    .send({
      targets: ['/eligible'],
      inputs: ZEROED_SCALARS,
      entities: { '/members': [APPLICANT_ROW] },
    })
  assert.equal(res.status, 200)
  assert.equal(res.body.traces, undefined)
})

test('trace is present when include: ["trace"]', async () => {
  const res = await request(app)
    .post(QUERY_URL)
    .send({
      targets: ['/eligible'],
      inputs: ZEROED_SCALARS,
      entities: { '/members': [APPLICANT_ROW] },
      include: ['trace'],
    })
  assert.equal(res.status, 200)
  assert.ok(res.body.traces, 'expected traces in response')
  assert.ok(res.body.traces['/eligible'], 'expected trace for /eligible')
  const root = res.body.traces['/eligible'] as TraceNode
  assert.equal(root.path, '/eligible')
  assert.equal(root.op, 'All')
})

test('SNAP denial: over the gross income limit produces a failing-branch trace down to the leaf comparison', async () => {
  // Single applicant, $3500 earned income, not BBCE, no elderly/disabled
  // members → fails gross income test (3500 > 130% of FPL for size 1).
  const res = await request(app)
    .post(QUERY_URL)
    .send({
      targets: ['/eligible'],
      inputs: {
        ...ZEROED_SCALARS,
        '/grossEarnedIncome': 3500,
      },
      entities: { '/members': [APPLICANT_ROW] },
      include: ['trace'],
    })
  assert.equal(res.status, 200)
  assert.equal(res.body.values['/eligible'], false)
  const root = res.body.traces['/eligible'] as TraceNode

  // The trace should reach /grossIncomeEligible as the deciding gate.
  const grossNode = findByPath(root, '/grossIncomeEligible')
  assert.ok(grossNode, '/grossIncomeEligible should appear in the trace')
  assert.equal(grossNode!.value, false)
  assert.equal(grossNode!.op, 'Any') // it's an Any over (elderly/disabled, income ≤ limit)

  // And inside that Any, the LessThanOrEqual comparison should carry
  // the concrete numbers in its reason.
  const comparisons = (grossNode!.children ?? []).filter(
    (c) => c.op === 'LessThanOrEqual'
  )
  assert.equal(comparisons.length, 1, 'expected one LessThanOrEqual child')
  const cmp = comparisons[0]
  assert.equal(cmp.value, false)
  assert.match(
    cmp.reason,
    /Gross monthly income.*3500.*Gross income limit/,
    'comparison reason should include the concrete operand values'
  )
})

test('trace exposes citations from references.json on facts that have policy mappings', async () => {
  const res = await request(app)
    .post(QUERY_URL)
    .send({
      targets: ['/eligible'],
      inputs: { ...ZEROED_SCALARS, '/grossEarnedIncome': 3500 },
      entities: { '/members': [APPLICANT_ROW] },
      include: ['trace'],
    })
  assert.equal(res.status, 200)
  const root = res.body.traces['/eligible'] as TraceNode
  const limit = findByPath(root, '/grossIncomeLimit')
  assert.ok(limit, '/grossIncomeLimit should appear in trace')
  assert.ok(
    limit!.citations && limit!.citations.length > 0,
    '/grossIncomeLimit should carry policy citations'
  )
  for (const c of limit!.citations!) {
    assert.equal(typeof c.sectionId, 'string')
    assert.equal(typeof c.documentTitle, 'string')
  }
})

test('eligible household: trace shows Any-true short-circuit through meetsCategoricalEligibility', async () => {
  // BBCE → /normalEligibility might be true/false but the Any() over it
  // and /meetsCategoricalEligibility wins via the categorical branch.
  const res = await request(app)
    .post(QUERY_URL)
    .send({
      targets: ['/eligible'],
      inputs: {
        ...ZEROED_SCALARS,
        '/meetsCategoricalEligibility': true,
      },
      entities: { '/members': [APPLICANT_ROW] },
      include: ['trace'],
    })
  assert.equal(res.status, 200)
  assert.equal(res.body.values['/eligible'], true)
  const root = res.body.traces['/eligible'] as TraceNode
  assert.equal(root.value, true)
  assert.equal(root.op, 'All') // /eligible = All(Any(...), hasEligiblePerson)

  // First child is the inner Any — it should be satisfied via the
  // categorical branch.
  const anyChild = root.children?.find((c) => c.op === 'Any')
  assert.ok(anyChild, 'expected inner Any in eligible trace')
  assert.equal(anyChild!.value, true)
  assert.match(
    anyChild!.reason,
    /held\.?$/,
    'Any-true should describe the operand that held without value judgment'
  )
})

test('opaque ops (Multiply, Subtract, etc.) report the computed value without children', async () => {
  const res = await request(app)
    .post(QUERY_URL)
    .send({
      targets: ['/eligible'],
      inputs: ZEROED_SCALARS,
      entities: { '/members': [APPLICANT_ROW] },
      include: ['trace'],
    })
  const root = res.body.traces['/eligible'] as TraceNode
  const limit = findByPath(root, '/grossIncomeLimit')
  // /grossIncomeLimit is a Multiply — V1 reports the value but doesn't
  // recurse into FPL × rate. The value is real (computed by the engine)
  // and the reason explains the limitation.
  assert.ok(limit)
  assert.equal(limit!.op, 'Multiply')
  assert.equal(typeof limit!.value, 'number')
  assert.match(limit!.reason, /Multiply/)
  // No children because we don't descend into arithmetic.
  assert.ok(
    !limit!.children || limit!.children.length === 0,
    'Multiply should not have children in V1'
  )
})

test('multi-target requests get one trace per target', async () => {
  const res = await request(app)
    .post(QUERY_URL)
    .send({
      targets: ['/eligible', '/grossIncomeEligible'],
      inputs: ZEROED_SCALARS,
      entities: { '/members': [APPLICANT_ROW] },
      include: ['trace'],
    })
  assert.equal(res.status, 200)
  assert.ok(res.body.traces['/eligible'])
  assert.ok(res.body.traces['/grossIncomeEligible'])
  assert.equal(res.body.traces['/eligible'].path, '/eligible')
  assert.equal(res.body.traces['/grossIncomeEligible'].path, '/grossIncomeEligible')
})

test('trace prose is value-neutral — no "failed" / "satisfied" words for boolean ops', async () => {
  // The walker has no way to know if false means "denied" or just "this
  // boolean happened to be false." Prose should describe the math
  // (held / did not hold) without smuggling in good/bad judgment.
  const res = await request(app)
    .post(QUERY_URL)
    .send({
      targets: ['/eligible'],
      inputs: { ...ZEROED_SCALARS, '/grossEarnedIncome': 3500 },
      entities: { '/members': [APPLICANT_ROW] },
      include: ['trace'],
    })
  const root = res.body.traces['/eligible'] as TraceNode

  // Collect every reason in the tree.
  const reasons: string[] = []
  const visit = (n: TraceNode) => {
    reasons.push(n.reason)
    for (const c of n.children ?? []) visit(c)
  }
  visit(root)

  // None of the reasons should use value-laden words. "Held" is OK —
  // it's standard logical/mathematical phrasing for "evaluated true".
  for (const r of reasons) {
    assert.doesNotMatch(
      r,
      /\b(failed|satisfied)\b/i,
      `reason "${r}" should not use value-laden wording`
    )
  }
})

test('writable input target reports a Writable trace', async () => {
  const res = await request(app)
    .post(QUERY_URL)
    .send({
      targets: ['/grossEarnedIncome'],
      inputs: { '/grossEarnedIncome': 1500 },
      include: ['trace'],
    })
  assert.equal(res.status, 200)
  const t = res.body.traces['/grossEarnedIncome'] as TraceNode
  assert.equal(t.op, 'Writable')
  assert.equal(t.value, 1500)
  assert.match(t.reason, /Input value/)
})
