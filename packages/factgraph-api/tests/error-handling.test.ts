/**
 * Error-handling regression tests.
 *
 * Every failure mode must answer with RFC 9457 Problem Details as JSON —
 * never Express's default HTML error page. Covers the body-parser boundary
 * (malformed JSON, oversized payload), v2 request validation (bad row
 * shapes, duplicate member ids), and the fail-closed auth misconfiguration.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

import { app, RULESET_ID, withEnv } from './helpers.js'

const V2_SNAP_URL = '/v2/eligibility/snap/determination'

test('malformed JSON body is a 400 Problem Details, as JSON', async () => {
  const res = await request(app)
    .post('/v1/eligibility/evaluate/determination')
    .set('content-type', 'application/json')
    .send('{"program": "snap",')
  assert.equal(res.status, 400)
  assert.match(res.headers['content-type'], /application\/json/)
  assert.equal(res.body.type, 'https://tools.ietf.org/html/rfc9457')
  assert.equal(res.body.title, 'Invalid JSON')
  assert.equal(res.body.status, 400)
  assert.match(res.body.detail, /JSON/)
})

test('null sub-collection row is a 400 naming the offending element', async () => {
  const res = await request(app)
    .post(V2_SNAP_URL)
    .send({ members: [{ id: 'a', income: [null] }] })
  assert.equal(res.status, 400)
  assert.equal(res.body.type, 'https://tools.ietf.org/html/rfc9457')
  assert.equal(res.body.status, 400)
  assert.ok(
    (res.body.detail as string).includes('members.0.income.0'),
    `detail should name the bad element, got: ${res.body.detail}`
  )
})

test('duplicate member ids are rejected with a 400', async () => {
  const res = await request(app)
    .post(V2_SNAP_URL)
    .send({ members: [{ id: 'a' }, { id: 'a' }] })
  assert.equal(res.status, 400)
  assert.equal(res.body.status, 400)
  assert.ok(
    (res.body.detail as string).includes('duplicate member id'),
    `detail should flag the duplicate id, got: ${res.body.detail}`
  )
})

test('empty API_BEARER_TOKEN fails closed with a 503', async () => {
  // An operator who set the variable intended auth to be ON — an empty
  // value must not silently run the API open.
  await withEnv('API_BEARER_TOKEN', '', async () => {
    const res = await request(app).post(V2_SNAP_URL).send({})
    assert.equal(res.status, 503)
    assert.equal(res.body.type, 'https://tools.ietf.org/html/rfc9457')
    assert.equal(res.body.title, 'Authentication misconfigured')
    assert.equal(res.body.status, 503)
  })
})

test('payload over the 10 MB limit is a 413 Problem Details, as JSON', async () => {
  const big = 'a'.repeat(11 * 1024 * 1024)
  const res = await request(app)
    .post(`/v1/factgraph/${RULESET_ID}/query`)
    .set('content-type', 'application/json')
    .send(JSON.stringify(big))
  assert.equal(res.status, 413)
  assert.match(res.headers['content-type'], /application\/json/)
  assert.equal(res.body.type, 'https://tools.ietf.org/html/rfc9457')
  assert.equal(res.body.title, 'Payload too large')
  assert.equal(res.body.status, 413)
})

// ---------------------------------------------------------------------------
// Identity/date validation (2026-07-08 batch)
// ---------------------------------------------------------------------------

test('empty-string and non-string member ids are 400s', async () => {
  const empty = await request(app)
    .post('/v2/eligibility/medicaid/determination')
    .send({ members: [{ id: '', income: [] }] })
  assert.equal(empty.status, 400)
  assert.match(empty.body.detail, /non-empty string/)

  const numeric = await request(app)
    .post('/v2/eligibility/medicaid/determination')
    .send({ members: [{ id: 42, income: [] }] })
  assert.equal(numeric.status, 400)
})

test('an explicit id colliding with a positional fallback is a 400', async () => {
  const res = await request(app)
    .post('/v2/eligibility/snap/determination')
    .send({ members: [{ id: 'member-1' }, {}] })
  assert.equal(res.status, 400)
  assert.match(res.body.detail, /member-1/)
})

test('duplicate row ids within a member are a 400', async () => {
  const res = await request(app)
    .post('/v2/eligibility/snap/determination')
    .send({
      members: [
        {
          id: 'a',
          income: [
            { id: 'pay-1', type: 'wages_and_salaries', amount: 1, frequency: 'monthly' },
            { id: 'pay-1', type: 'wages_and_salaries', amount: 2, frequency: 'monthly' },
          ],
        },
      ],
    })
  assert.equal(res.status, 400)
  assert.match(res.body.detail, /duplicate income row id/)
})

test('asOf dates that would roll over are rejected, valid ones accepted', async () => {
  const rollover = await request(app)
    .post('/v2/eligibility/snap/determination')
    .send({ asOf: '2026-02-30', members: [{ id: 'a' }] })
  assert.equal(rollover.status, 400)
  assert.match(rollover.body.detail, /2026-02-30/)

  const valid = await request(app)
    .post('/v2/eligibility/snap/determination')
    .send({ asOf: '2026-02-28', members: [{ id: 'a' }] })
  assert.equal(valid.status, 200)
  assert.equal(valid.body.asOf, '2026-02-28')
})
