/**
 * Trace-walker branch coverage (src/explain.ts) that no test previously
 * exercised: the Not operator, caret/relative/bare-name dependency
 * resolution, the cycle behavior, MAX_DEPTH truncation, Enum literal
 * operands, and the engine-throw → RFC 9457 error path.
 *
 * Driven end-to-end through POST /v1/factgraph/:rulesetId/query with
 * include: ["trace"] — pinning the wire shape, not internals. The SNAP
 * scenarios use the snap-complete golden profile (loadProfile), whose
 * engine-path inputs resolve the graph completely so every walked node
 * carries real values.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

import { app } from './helpers.js'
import { loadProfile } from './snap-golden-fixture.js'

type TraceNode = {
  path?: string
  name?: string
  op: string
  value: unknown
  reason: string
  decisive?: boolean
  memberId?: string
  children?: TraceNode[]
}

function* walk(node: TraceNode): Generator<TraceNode> {
  yield node
  for (const c of node.children ?? []) yield* walk(c)
}

/** The golden profile as unified /query inputs: engine-path scalars plus
 *  the entity collections keyed by their roots. */
function engineInputs(): Record<string, unknown> {
  const p = loadProfile()
  return { ...p.inputs, ...p.entities }
}

/** One shared golden-profile trace query for the SNAP-based tests below —
 *  the walker is deterministic, so re-querying per test would only re-pay
 *  the engine run. */
let goldenPromise:
  | Promise<{ status: number; body: Record<string, never> & { status: string; values: Record<string, unknown>; traces: Record<string, TraceNode> } }>
  | undefined
function golden() {
  goldenPromise ??= (async () =>
    await request(app).post('/v1/factgraph/snap-complete/query').send({
      targets: [
        '/eligibilityCategory',
        '/standardEligibilityApplies',
        '/members/*/receivesSsiOrDisabilityBenefits',
        '/members/*/isFullTimeStudent',
        '/incomes/*/isEarned',
      ],
      inputs: engineInputs(),
      include: ['trace'],
    }))()
  return goldenPromise
}

// ---------------------------------------------------------------------------
// 1. Not operator
// ---------------------------------------------------------------------------

test('Not nodes negate their child, mark it decisive, and phrase the reason neutrally', async () => {
  const res = await golden()
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'complete', 'the golden profile resolves fully')
  // Ground the scenario: the profile household qualifies via ECE, so the
  // BCE/ECE/SE facts the Not nodes guard actually evaluated.
  assert.equal(res.body.values['/eligibilityCategory'], 'Ece')

  const nots: TraceNode[] = []
  for (const target of ['/eligibilityCategory', '/standardEligibilityApplies']) {
    for (const n of walk(res.body.traces[target])) if (n.op === 'Not') nots.push(n)
  }
  // BCE/ECE/SE gate on Not(disqualified…)/Not(lottery…) — several must appear.
  assert.ok(nots.length >= 3, `expected several Not nodes in the BCE/ECE trace, found ${nots.length}`)

  for (const n of nots) {
    assert.equal(n.children?.length, 1, 'Not has exactly one operand')
    const child = n.children![0]
    // Single-operand structures are always decisive — there is nothing
    // else the parent's value could have come from.
    assert.equal(child.decisive, true, 'the single operand of a Not is decisive')
    // Where both sides resolved, the value IS the negation. (The walker
    // derives nested values from operands; a mismatch would mean it echoed
    // some other value instead of computing the inversion.)
    if (typeof n.value === 'boolean' && typeof child.value === 'boolean') {
      assert.equal(n.value, !child.value, `Not(${child.value}) must be ${!child.value}`)
    }
    // Reason wording is part of the wire contract (caseworker UIs render
    // it verbatim) and deliberately neutral — "held"/"did not hold", no
    // judgment about whether that outcome is good.
    const expectedReason =
      n.value === true
        ? 'Operand did not hold, so Not held.'
        : n.value === false
          ? 'Operand held, so Not did not hold.'
          : 'Operand has not yet evaluated.'
    assert.equal(n.reason, expectedReason)
  }
})

// ---------------------------------------------------------------------------
// 2. Caret escapes, `../` siblings, and bare-name dependencies
// ---------------------------------------------------------------------------

test('caret/bare-name dependencies resolve — no "Unresolved dependency" anywhere in the golden traces', async () => {
  const res = await golden()
  assert.equal(res.status, 200)

  // /members/*/receivesSsiOrDisabilityBenefits filters /incomes with
  // `path="^"` (the SelfStack escape) and bare names (`memberId`, `type`)
  // scoped to the Filter's collection; /members/*/isFullTimeStudent uses a
  // `../studentEnrollmentStatus` sibling. If any of those resolution rules
  // regressed, the walker would emit "Unresolved dependency: <raw>" nodes.
  for (const [target, trace] of Object.entries(res.body.traces)) {
    for (const n of walk(trace)) {
      assert.ok(
        !/Unresolved dependency/.test(n.reason),
        `${target}: unresolved dependency leaked into the trace: ${n.reason}`
      )
    }
  }

  // The `../` sibling resolved to a real walked fact: the Equal's left
  // operand is the studentEnrollmentStatus writable itself.
  const student = res.body.traces['/members/*/isFullTimeStudent']
  assert.equal(student.op, 'PerMember', 'collection-scoped target gets a PerMember root')
  const row = student.children![0]
  assert.equal(row.memberId, 'member-0', 'profile rows carry no ids — positional fallback')
  assert.equal(row.op, 'Equal')
  assert.equal(
    row.children![0].path,
    '/members/*/studentEnrollmentStatus',
    '../studentEnrollmentStatus resolved to the sibling fact'
  )
  assert.equal(row.children![0].op, 'Writable')

  // The Filter's bare names resolved against its collection scope: the
  // opaque CollectionSize surfaces the per-row facts it read as
  // CollectionRead children (what the finality gate inspects).
  const ssi = res.body.traces['/members/*/receivesSsiOrDisabilityBenefits']
  const ssiRow = ssi.children![0]
  assert.equal(ssiRow.op, 'GreaterThan')
  assert.equal(typeof ssiRow.value, 'boolean', 'engine ground truth supplies the root comparison value')
  const size = ssiRow.children![0]
  assert.equal(size.op, 'CollectionSize')
  assert.equal(size.value, null, 'opaque sub-expressions do not fabricate values')
  assert.deepEqual(
    new Set((size.children ?? []).map((c) => `${c.op}:${c.path}`)),
    new Set([
      'CollectionRead:/incomes/*/memberId',
      'CollectionRead:/incomes/*/type',
    ]),
    'bare names inside the Filter resolved to /incomes/*/… collection reads'
  )
})

// ---------------------------------------------------------------------------
// 3. Cycle behavior
// ---------------------------------------------------------------------------

test('a cyclic ruleset returns 200 with null values and a terminating trace — no hang', async () => {
  // cycle-example: A = B + seed, B = C * 2, C = A + 1 (3-node cycle);
  // D = A * 10 sits downstream of it.
  const res = await request(app).post('/v1/factgraph/cycle-example/query').send({
    targets: ['/a', '/d'],
    inputs: { '/seed': 1 },
    include: ['trace'],
  })
  assert.equal(res.status, 200, 'a cycle is not a server error')
  assert.equal(res.body.status, 'incomplete')
  // The engine cannot resolve a cyclic fact; the API reports null rather
  // than fabricating or looping.
  assert.equal(res.body.values['/a'], null)
  assert.equal(res.body.values['/d'], null)

  // The walker terminates trivially here: the cycle runs through Add /
  // Multiply, which the walker treats as opaque (no descent), so each
  // trace is a single Opaque-arithmetic node and the `ctx.stack` cycle
  // guard ("Trace truncated to avoid cycle.") never needs to fire. Pin
  // that shape — if arithmetic ops ever become walkable, this test will
  // flag that the cycle guard is now load-bearing and needs direct cover.
  for (const [target, op] of [['/a', 'Add'], ['/d', 'Multiply']] as const) {
    const trace = res.body.traces[target] as TraceNode
    const nodes = [...walk(trace)]
    assert.equal(nodes.length, 1, `${target}: opaque arithmetic root only`)
    assert.equal(trace.op, op)
    assert.equal(trace.value, null)
    assert.equal(nodes.filter((n) => n.op === 'Truncated').length, 0)
  }
})

// ---------------------------------------------------------------------------
// 4. MAX_DEPTH truncation
// ---------------------------------------------------------------------------

test('deep traces truncate at max depth with the documented reason, and the response stays 200', async () => {
  // direct-file-full (3,017 facts) chains boolean logic deep enough to
  // cross the walker's MAX_DEPTH (24). No inputs needed — the walker
  // descends structure regardless of resolution.
  const res = await request(app).post('/v1/factgraph/direct-file-full/query').send({
    targets: ['/cdccOrEitcQualified'],
    include: ['trace'],
  })
  assert.equal(res.status, 200, 'a truncated trace is not an error')
  assert.equal(res.body.status, 'incomplete')

  const trace = res.body.traces['/cdccOrEitcQualified'] as TraceNode
  const truncated = [...walk(trace)].filter((n) => n.op === 'Truncated')
  assert.ok(truncated.length > 0, 'the depth guard fires somewhere in a 24+-deep chain')
  for (const n of truncated) {
    // The reason tells the caller the recovery move (re-query the fact
    // directly for a fresh, shallower trace) — pin the exact wording.
    assert.equal(
      n.reason,
      'Trace truncated at max depth — query this fact directly for a fresh trace.'
    )
    // Truncation is a hard stop: no children below a Truncated node, and
    // the node still names the fact so the caller can re-target it.
    assert.equal(n.children, undefined)
    assert.ok(typeof n.path === 'string' && n.path.startsWith('/'), 'truncated nodes keep their path')
  }
})

// ---------------------------------------------------------------------------
// 5. Enum literals
// ---------------------------------------------------------------------------

test('Enum literal operands carry the option string and the comparison over them computes a real boolean', async () => {
  const res = await golden()
  assert.equal(res.status, 200)

  // /members/*/isFullTimeStudent is Equal(../studentEnrollmentStatus,
  // Enum "FullTime") at the fact root — the cleanest walked Enum operand.
  const student = res.body.traces['/members/*/isFullTimeStudent']
  const eq = student.children![0]
  assert.equal(eq.op, 'Equal')
  assert.equal(typeof eq.value, 'boolean', 'comparison over an Enum resolves to a real boolean')
  const enumNode = eq.children![1]
  assert.equal(enumNode.op, 'Enum')
  assert.equal(enumNode.value, 'FullTime', 'the option string IS the literal value')
  assert.equal(enumNode.reason, 'Literal Enum: FullTime')
  assert.equal(enumNode.decisive, true, 'comparison operands contribute equally')
  // The comparison's reason embeds both operand values — this is what a
  // caseworker UI renders, so the concrete strings matter.
  assert.match(eq.reason, /= Enum \(FullTime\) — (held|did not hold)\./)

  // /incomes/*/isEarned = Any over Equal(../type, Enum …): with the
  // profile's wages row, the WagesAndSalaries case holds and is decisive.
  const earned = res.body.traces['/incomes/*/isEarned']
  const earnedRow = earned.children![0]
  assert.equal(earnedRow.op, 'Any')
  assert.equal(earnedRow.value, true)
  const decisiveEq = (earnedRow.children ?? []).find((c) => c.decisive)
  assert.ok(decisiveEq, 'the Any that held marks its first true operand decisive')
  assert.equal(decisiveEq!.op, 'Equal')
  assert.equal(decisiveEq!.value, true)
  assert.equal(decisiveEq!.children![1].op, 'Enum')
  assert.equal(decisiveEq!.children![1].value, 'WagesAndSalaries')
})

// ---------------------------------------------------------------------------
// 6. Engine throw → RFC 9457, never HTML
// ---------------------------------------------------------------------------

test('an engine throw surfaces as a 500 Problem Details JSON, never HTML', async () => {
  // Object values where the engine expects scalars pass request validation
  // (inputs values are z.unknown by design — the engine owns typing) and
  // detonate inside execution. The /query route catches the throw and maps
  // it to RFC 9457; without that boundary Express would emit its HTML
  // error page, which no API client can parse.
  const res = await request(app).post('/v1/factgraph/snap-complete/query').send({
    targets: ['/allotment'],
    inputs: {
      '/applicationFilingDate': { nested: 'object' },
      '/members': [{ '/members/*/age': { bad: true } }],
    },
  })
  assert.equal(res.status, 500)
  assert.match(res.headers['content-type'], /application\/json/)
  assert.equal(res.body.type, 'https://tools.ietf.org/html/rfc9457')
  assert.equal(res.body.title, 'Execution failed')
  assert.equal(res.body.status, 500)
  // (The app-level catch-all errorHandler in server.ts is exercised by
  // error-handling.test.ts via malformed JSON / oversized payloads; this
  // pins the execution-boundary 500, the one an engine regression would hit.)
})

test('a scalar at a collection root does NOT throw — it is treated as an unprovided collection', async () => {
  // Deliberate contrast with the throw case above: `"/members": "not-an-
  // array"` survives zod (unknown values) and splitInputs classifies the
  // non-array value as a scalar, so /members is simply never provided.
  // The engine runs, the cleared-collection walk marks member facts as
  // still-needed, and the caller gets a useful incomplete — not a 500.
  const res = await request(app).post('/v1/factgraph/snap-complete/query').send({
    targets: ['/allotment'],
    inputs: { '/members': 'not-an-array' },
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'incomplete')
  assert.equal(res.body.values['/allotment'], null)
  assert.ok(
    (res.body.missingInputs as Array<{ path: string }>).some((m) =>
      m.path.startsWith('/members/*/')
    ),
    'member-level inputs are reported as still needed'
  )
})
