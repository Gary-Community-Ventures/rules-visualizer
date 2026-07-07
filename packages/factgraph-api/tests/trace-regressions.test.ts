/**
 * Trace-walker regression tests.
 *
 * Pins the fixed behaviors of src/explain.ts:
 *   - a comparison sub-expression computes its own value from its operands
 *     instead of echoing the enclosing fact's engine result (the
 *     parent-value echo bug),
 *   - relative Dependency paths (bare sibling names, `../`, `^`) resolve
 *     instead of surfacing as "Unresolved dependency",
 *   - deciding paths carry the row's memberId through PerMember wrappers,
 *   - pending (null-valued) nodes never claim a held / did-not-hold outcome,
 *   - structural consistency between an operator's value and its operands.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

import { app, RULESET_ID, APPLICANT_ROW, ZEROED_SCALARS } from './helpers.js'

const QUERY_URL = `/v1/factgraph/${RULESET_ID}/query`

type TraceNode = {
  path?: string
  name?: string
  op: string
  value: unknown
  reason: string
  memberId?: string
  decisive?: boolean
  children?: TraceNode[]
}

type DecidingPathStep = {
  path: string
  value: unknown
  op: string
  memberId?: string
}

/** Depth-first search for the first node matching a predicate. */
function findNode(
  node: TraceNode | undefined,
  pred: (n: TraceNode) => boolean
): TraceNode | undefined {
  if (!node) return undefined
  if (pred(node)) return node
  for (const c of node.children ?? []) {
    const found = findNode(c, pred)
    if (found) return found
  }
  return undefined
}

/** Visit every node in a trace tree. */
function visitAll(node: TraceNode | undefined, fn: (n: TraceNode) => void): void {
  if (!node) return
  fn(node)
  for (const c of node.children ?? []) visitAll(c, fn)
}

/** An elderly single-member household with income far over the limit —
 *  /grossIncomeEligible is Any(elderly-or-disabled, income ≤ limit) and
 *  resolves true via the elderly branch while the comparison is false. */
const ELDERLY_OVER_INCOME_INPUTS = {
  ...ZEROED_SCALARS,
  '/grossEarnedIncome': 99999,
  '/members': [
    {
      ...APPLICANT_ROW,
      '/members/*/isElderly': true,
      '/members/*/age': 70,
      '/members/*/weeklyWorkHours': 0,
    },
  ],
}

test('comparison sub-expression computes its own value, not the parent Any\'s', async () => {
  // Regression: the walker used to echo the enclosing fact's engine result
  // onto every sub-expression, so the failing income comparison inside a
  // true Any reported value=true / "held".
  const res = await request(app)
    .post(QUERY_URL)
    .send({
      targets: ['/grossIncomeEligible'],
      inputs: ELDERLY_OVER_INCOME_INPUTS,
      include: ['trace'],
    })
  assert.equal(res.status, 200)
  const root = res.body.traces['/grossIncomeEligible'] as TraceNode

  assert.equal(root.op, 'Any')
  assert.equal(root.value, true)
  assert.equal(root.reason, 'Elderly or disabled member held.')

  const cmp = findNode(root, (n) => n.op === 'LessThanOrEqual')
  assert.ok(cmp, 'expected a LessThanOrEqual descendant (income ≤ limit)')
  assert.equal(cmp!.value, false, 'the income comparison itself is false')
  assert.equal(cmp!.decisive, false, 'the false branch did not decide the true Any')
  assert.match(cmp!.reason, /did not hold/)
  assert.doesNotMatch(cmp!.reason, /— held\./, 'must not echo the parent\'s outcome')
})

const STUDENT_AGE_REQUEST = {
  targets: ['/members/*/meetsStudentAgeException'],
  inputs: {
    ...ZEROED_SCALARS,
    '/members': [
      {
        ...APPLICANT_ROW,
        '/members/*/isElderly': true,
        '/members/*/age': 70,
        '/members/*/weeklyWorkHours': 0,
      },
    ],
  },
  include: ['trace'],
}

test('relative dependency paths resolve inside a per-member trace', async () => {
  // /members/*/meetsStudentAgeException compares the member's age against
  // sibling threshold facts referenced by relative paths. Regression: those
  // used to surface as "Unresolved dependency" nodes.
  const res = await request(app).post(QUERY_URL).send(STUDENT_AGE_REQUEST)
  assert.equal(res.status, 200)
  const root = res.body.traces['/members/*/meetsStudentAgeException'] as TraceNode

  assert.equal(root.op, 'PerMember')
  assert.deepEqual(root.value, [true])
  assert.ok(root.children && root.children.length === 1, 'one per-row sub-trace')
  const row = root.children![0]
  assert.equal(row.memberId, 'applicant')
  assert.equal(row.op, 'Any')
  assert.equal(row.value, true)

  const gte = findNode(row, (n) => n.op === 'GreaterThanOrEqual')
  assert.ok(gte, 'expected the age ≥ upper-threshold condition')
  assert.equal(gte!.value, true)
  assert.equal(gte!.decisive, true)
  assert.match(gte!.reason, /Age \(70\) ≥ .*\(50\).*held/)

  const lt = findNode(row, (n) => n.op === 'LessThan')
  assert.ok(lt, 'expected the age < lower-threshold condition')
  assert.equal(lt!.value, false)
  assert.equal(lt!.decisive, false)

  visitAll(root, (n) => {
    assert.ok(
      !n.reason.includes('Unresolved dependency'),
      `no node should report an unresolved dependency, got: "${n.reason}"`
    )
  })
})

test('decidingPaths carry memberId through PerMember wrappers', async () => {
  const res = await request(app).post(QUERY_URL).send(STUDENT_AGE_REQUEST)
  assert.equal(res.status, 200)
  const steps = res.body.decidingPaths[
    '/members/*/meetsStudentAgeException'
  ] as DecidingPathStep[]
  assert.ok(Array.isArray(steps), 'decidingPaths entry present')
  assert.ok(
    steps.length >= 2,
    'the deciding path continues past the PerMember wrapper into the row'
  )
  for (const step of steps.slice(1)) {
    assert.equal(
      step.memberId,
      'applicant',
      'steps inside the row sub-trace are tagged with the row id'
    )
  }
})

test('traces under incomplete input stay honest — pending nodes claim no outcome', async () => {
  const res = await request(app)
    .post(QUERY_URL)
    .send({
      targets: ['/eligible'],
      inputs: { '/members': [APPLICANT_ROW] },
      include: ['trace'],
    })
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'incomplete')

  const root = res.body.traces['/eligible'] as TraceNode
  let sawPendingReason = false
  visitAll(root, (n) => {
    if (n.value === null) {
      assert.doesNotMatch(
        n.reason,
        /— (held|did not hold)\./,
        `pending node must not claim an outcome: "${n.reason}"`
      )
    }
    if (/pending|not yet evaluated|No value provided/.test(n.reason)) {
      sawPendingReason = true
    }
  })
  assert.ok(sawPendingReason, 'at least one node reports still-pending state')
})

// ---------------------------------------------------------------------------
// Structural consistency property — an operator's reported value must agree
// with the values of its own operands, in every scenario.
// ---------------------------------------------------------------------------

const COMPARATORS: Record<string, (l: number | string, r: number | string) => boolean> = {
  GreaterThan: (l, r) => l > r,
  GreaterThanOrEqual: (l, r) => l >= r,
  LessThan: (l, r) => l < r,
  LessThanOrEqual: (l, r) => l <= r,
  Equal: (l, r) => l === r,
  NotEqual: (l, r) => l !== r,
}

function bothComparable(l: unknown, r: unknown): l is number | string {
  return (
    l != null &&
    r != null &&
    ((typeof l === 'number' && typeof r === 'number') ||
      (typeof l === 'string' && typeof r === 'string'))
  )
}

/** Assert value/operand consistency for every node in a trace tree. */
function assertTraceConsistent(root: TraceNode): void {
  visitAll(root, (n) => {
    const kids = n.children ?? []
    const cmp = COMPARATORS[n.op]
    if (cmp && kids.length === 2) {
      const [l, r] = [kids[0].value, kids[1].value]
      if (bothComparable(l, r) && bothComparable(r, l)) {
        assert.equal(
          n.value,
          cmp(l as number | string, r as number | string),
          `${n.op}(${JSON.stringify(l)}, ${JSON.stringify(r)}) reported ${JSON.stringify(n.value)} — value must equal the operator applied to its operands (reason: "${n.reason}")`
        )
      }
    }
    if (n.op === 'All' && kids.length > 0 && kids.some((c) => c.value === false)) {
      assert.notEqual(
        n.value,
        true,
        `All with a false operand cannot be true (reason: "${n.reason}")`
      )
    }
    if (n.op === 'Any' && kids.some((c) => c.value === true)) {
      assert.notEqual(
        n.value,
        false,
        `Any with a true operand cannot be false (reason: "${n.reason}")`
      )
    }
  })
}

test('trace consistency property holds across resolved, per-member, and pending scenarios', async () => {
  const scenarios: Array<{ targets: string[]; inputs: Record<string, unknown> }> = [
    // (a) elderly + over-income: mixed true/false branches.
    { targets: ['/grossIncomeEligible'], inputs: ELDERLY_OVER_INCOME_INPUTS },
    // (b) per-member target with relative dependencies.
    { targets: STUDENT_AGE_REQUEST.targets, inputs: STUDENT_AGE_REQUEST.inputs },
    // (d) incomplete input: plenty of null-valued nodes.
    { targets: ['/eligible'], inputs: { '/members': [APPLICANT_ROW] } },
    // Fully-resolved eligible household.
    {
      targets: ['/eligible', '/snap'],
      inputs: { ...ZEROED_SCALARS, '/members': [APPLICANT_ROW] },
    },
  ]

  for (const scenario of scenarios) {
    const res = await request(app)
      .post(QUERY_URL)
      .send({ ...scenario, include: ['trace'] })
    assert.equal(res.status, 200)
    for (const target of scenario.targets) {
      const root = res.body.traces[target] as TraceNode
      assert.ok(root, `trace present for ${target}`)
      assertTraceConsistent(root)
    }
  }
})
