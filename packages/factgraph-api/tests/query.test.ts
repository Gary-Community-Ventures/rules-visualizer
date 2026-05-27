import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

import {
  app,
  RULESET_ID,
  APPLICANT_ROW,
  CHILD_ROW,
  ZEROED_SCALARS,
} from './helpers.js'

const QUERY_URL = `/v1/factgraph/${RULESET_ID}/query`

// ---------------------------------------------------------------------------
// Happy-path scenarios
// ---------------------------------------------------------------------------

test('empty inputs returns full intake-form shape (smart walker + collection backfill)', async () => {
  const res = await request(app)
    .post(QUERY_URL)
    .send({ targets: ['/eligible'] })
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'incomplete')
  assert.deepEqual(res.body.values, { '/eligible': null })

  const missingPaths = (res.body.missingInputs as { path: string }[]).map(
    (m) => m.path
  )
  // Scalars from the form
  for (const p of [
    '/grossEarnedIncome',
    '/unearnedIncome',
    '/rent',
    '/meetsCategoricalEligibility',
  ]) {
    assert.ok(missingPaths.includes(p), `expected ${p} in missingInputs`)
  }
  // Per-member fields surface because /members wasn't provided.
  assert.ok(
    missingPaths.some((p) => p.startsWith('/members/*/')),
    'expected at least one /members/*/... in missingInputs'
  )
  // supportingFacts not requested → omitted.
  assert.equal(res.body.supportingFacts, undefined)
})

test('full single-person determination resolves to FY2026 max allotment', async () => {
  const res = await request(app)
    .post(QUERY_URL)
    .send({
      targets: ['/snap'],
      inputs: { ...ZEROED_SCALARS, '/members': [APPLICANT_ROW] },
    })
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'complete')
  assert.equal(res.body.values['/snap'], 298)
  assert.equal(res.body.missingInputs, undefined)
})

test('multi-target resolves multiple values in one engine run', async () => {
  const res = await request(app)
    .post(QUERY_URL)
    .send({
      targets: ['/eligible', '/snap', '/grossIncomeLimit'],
      inputs: { ...ZEROED_SCALARS, '/members': [APPLICANT_ROW] },
    })
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'complete')
  assert.equal(res.body.values['/eligible'], true)
  assert.equal(res.body.values['/snap'], 298)
  assert.equal(typeof res.body.values['/grossIncomeLimit'], 'number')
})

test('BBCE short-circuit (smart walker prunes income/asset subtree)', async () => {
  // With meetsCategoricalEligibility: true, the engine can resolve /eligible
  // via the Any short-circuit. Even with all scalars zero we still expect
  // complete + value: true. The win is that this still works correctly
  // even if some scalars were missing — but we test with full scalars here
  // so we're checking the value, not the missing-input narrowing.
  const res = await request(app)
    .post(QUERY_URL)
    .send({
      targets: ['/eligible'],
      inputs: {  ...ZEROED_SCALARS, '/meetsCategoricalEligibility': true, '/members': [APPLICANT_ROW] },
    })
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'complete')
  assert.equal(res.body.values['/eligible'], true)
})

test('include: ["supportingFacts"] populates the trace', async () => {
  const res = await request(app)
    .post(QUERY_URL)
    .send({
      targets: ['/eligible'],
      inputs: { ...ZEROED_SCALARS, '/members': [APPLICANT_ROW] },
      include: ['supportingFacts'],
    })
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'complete')
  assert.ok(Array.isArray(res.body.supportingFacts))
  assert.ok(
    res.body.supportingFacts.length > 0,
    'expected at least one supporting fact'
  )
  // Every entry has the documented shape.
  for (const f of res.body.supportingFacts) {
    assert.equal(typeof f.path, 'string')
    assert.equal(typeof f.name, 'string')
    assert.notEqual(f.value, undefined)
  }
})

test('metadata is echoed back unchanged', async () => {
  const metadata = {
    applicationId: 'app-001',
    traceId: 'trace-xyz',
    nested: { deep: { value: 42 } },
  }
  const res = await request(app)
    .post(QUERY_URL)
    .send({
      targets: ['/eligible'],
      metadata,
    })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.metadata, metadata)
})

test('metadata omitted from response when not in request', async () => {
  const res = await request(app)
    .post(QUERY_URL)
    .send({ targets: ['/eligible'] })
  assert.equal(res.status, 200)
  assert.equal(res.body.metadata, undefined)
})

test('per-member target returns array of {memberId, value} correlated to caller-provided ids', async () => {
  const res = await request(app)
    .post(QUERY_URL)
    .send({
      targets: ['/members/*/isEligibleMember'],
      inputs: { ...ZEROED_SCALARS, '/members': [APPLICANT_ROW, CHILD_ROW] },
    })
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'complete')
  const value = res.body.values['/members/*/isEligibleMember']
  assert.ok(Array.isArray(value))
  assert.equal(value.length, 2)
  assert.equal(value[0].memberId, 'applicant')
  assert.equal(value[1].memberId, 'child')
  for (const entry of value) {
    assert.equal(typeof entry.value, 'boolean')
  }
})

test('per-member target auto-generates member-N ids when caller omits them', async () => {
  // Same APPLICANT_ROW minus the id field.
  const { id: _drop, ...anonymous } = APPLICANT_ROW
  void _drop
  const res = await request(app)
    .post(QUERY_URL)
    .send({
      targets: ['/members/*/isEligibleMember'],
      inputs: { ...ZEROED_SCALARS, '/members': [anonymous] },
    })
  assert.equal(res.status, 200)
  const value = res.body.values['/members/*/isEligibleMember']
  assert.ok(Array.isArray(value))
  assert.equal(value[0].memberId, 'member-0')
})

test('intermediate gates are queryable directly', async () => {
  // /grossIncomeLimit transitively needs /householdSize which needs every
  // /members/*/isEligibleMember to resolve, so we pass the full applicant
  // row. The point of this test is that querying an intermediate fact is
  // a first-class operation — not that minimal input suffices for it.
  const res = await request(app)
    .post(QUERY_URL)
    .send({
      targets: ['/grossIncomeLimit'],
      inputs: { '/members': [APPLICANT_ROW] },
    })
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'complete')
  assert.equal(typeof res.body.values['/grossIncomeLimit'], 'number')
})

test('intermediate gate that lacks inputs returns incomplete with useful missingInputs', async () => {
  // Same target, deliberately under-specified: only a subset of member
  // fields. The API should report incomplete, list the unresolved
  // dependencies, and still return null for the target rather than
  // throwing or silently fabricating a value.
  const res = await request(app)
    .post(QUERY_URL)
    .send({
      targets: ['/grossIncomeLimit'],
      inputs: { '/members': [
          {
            id: 'applicant',
            '/members/*/age': 30,
            '/members/*/isImmigrationEligible': true,
          },
        ] },
    })
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'incomplete')
  assert.equal(res.body.values['/grossIncomeLimit'], null)
  assert.ok(Array.isArray(res.body.missingInputs))
  assert.ok(res.body.missingInputs.length > 0)
})

// ---------------------------------------------------------------------------
// Validation (Zod → 400 Problem Details with errors[])
// ---------------------------------------------------------------------------

test('empty body → 400 with field path', async () => {
  const res = await request(app).post(QUERY_URL).send({})
  assert.equal(res.status, 400)
  assert.equal(res.body.title, 'Invalid request body')
  assert.ok(Array.isArray(res.body.errors))
  assert.ok(res.body.errors.some((e: { path: string }) => e.path === 'targets'))
})

test('targets as string instead of array → 400', async () => {
  const res = await request(app).post(QUERY_URL).send({ targets: '/eligible' })
  assert.equal(res.status, 400)
  assert.ok(res.body.errors.some((e: { path: string }) => e.path === 'targets'))
})

test('empty targets array → 400', async () => {
  const res = await request(app).post(QUERY_URL).send({ targets: [] })
  assert.equal(res.status, 400)
})

test('empty string inside targets array → 400 with path index', async () => {
  const res = await request(app)
    .post(QUERY_URL)
    .send({ targets: ['/eligible', ''] })
  assert.equal(res.status, 400)
  assert.ok(
    res.body.errors.some((e: { path: string }) => e.path === 'targets.1')
  )
})

test('non-string element in include → 400 with path index', async () => {
  const res = await request(app)
    .post(QUERY_URL)
    .send({ targets: ['/eligible'], include: [42] })
  assert.equal(res.status, 400)
  assert.ok(
    res.body.errors.some((e: { path: string }) => e.path === 'include.0')
  )
})

// ---------------------------------------------------------------------------
// Semantic 404s (request is well-formed but references non-existent things)
// ---------------------------------------------------------------------------

test('unknown ruleset → 404', async () => {
  const res = await request(app)
    .post('/v1/factgraph/does-not-exist/query')
    .send({ targets: ['/eligible'] })
  assert.equal(res.status, 404)
  assert.match(res.body.detail, /does-not-exist/)
})

test('unknown target → 404 lists every bad path', async () => {
  const res = await request(app)
    .post(QUERY_URL)
    .send({ targets: ['/eligible', '/doesNotExist', '/alsoMissing'] })
  assert.equal(res.status, 404)
  assert.match(res.body.detail, /\/doesNotExist/)
  assert.match(res.body.detail, /\/alsoMissing/)
})
