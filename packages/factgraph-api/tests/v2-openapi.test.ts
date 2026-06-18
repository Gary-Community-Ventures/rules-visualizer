/**
 * The v2 engine-shaped contract: served publicly, path-free, and matching the
 * implemented endpoint — a friendly request, a unified determinations[]
 * response, and missingInputs in the request vocabulary. /evaluate/determination
 * is implemented; the other evaluate tails are still 501 stubs.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

import { app } from './helpers.js'

test('v2 spec is served unauthenticated and labeled the engine-shaped contract', async () => {
  const res = await request(app).get('/v2/eligibility/openapi.json')
  assert.equal(res.status, 200)
  assert.match(res.body.openapi, /^3\.1/)
  assert.match(res.body.info.title, /v2/)
  assert.match(res.body.info.title, /engine-shaped/i)
  assert.equal(res.body.info.version, '2.0.0')
  assert.match(res.body.info.description, /no-guess/i)
})

test('v2 spec carries the implemented request/response shape', async () => {
  const res = await request(app).get('/v2/eligibility/openapi.json')
  const schemas = res.body.components.schemas

  // Friendly request schemas.
  for (const name of ['DeterminationRequest', 'Member', 'IncomeRow', 'CaregiverRelationship']) {
    assert.ok(schemas[name], `expected schema ${name}`)
  }
  assert.ok(schemas.Member.properties.id, 'member carries the caller id handle')
  assert.ok(schemas.Member.properties.income, 'income nests under the member')

  // Unified response: ONE Determination schema, scoped, first-class outcome
  // fields, no x- prefixes, no oneOf union.
  const det = schemas.Determination.properties
  assert.deepEqual(det.scope.enum, ['household', 'member'])
  assert.ok(det.benefitAmount, 'benefitAmount is first-class')
  assert.ok(det.medicaidCategory, 'one Determination schema covers both programs')
  assert.equal(det['x-allotment'], undefined, 'no x- overlays')
  assert.ok(det.status.enum.includes('not_supported'))
  assert.ok(schemas.DeterminationResponse.properties.determinations)

  // missingInputs is in the friendly request vocabulary.
  const mi = schemas.MissingInput.properties
  assert.ok(mi.requestPath && mi.field && mi.location && mi.label)

  const det200 =
    res.body.paths['/v2/eligibility/evaluate/determination'].post.responses['200']
  const detSchema = det200.content['application/json'].schema
  assert.equal(detSchema.oneOf, undefined, 'determination 200 must not be a union')
  assert.match(detSchema.$ref, /DeterminationResponse/)
})

test('v2 request body ships a determination example', async () => {
  const res = await request(app).get('/v2/eligibility/openapi.json')
  const examples =
    res.body.paths['/v2/eligibility/evaluate/determination'].post.requestBody
      .content['application/json'].examples
  const example = Object.values(examples)[0] as { value: { programs: string[] } }
  assert.ok(example, 'expected a determination example')
  assert.ok(Array.isArray(example.value.programs))
})

test('v2 spec is path-free (no rules-engine internals)', async () => {
  const res = await request(app).get('/v2/eligibility/openapi.yaml')
  assert.ok(!/\/members\/\*/.test(res.text), 'leaked a /members/* path')
  assert.ok(!/eligibilityCategory|x-trace|TraceNode/.test(res.text), 'leaked engine internals')
})

test('v2 determination is implemented; the other evaluate tails are still 501 stubs', async () => {
  const det = await request(app)
    .post('/v2/eligibility/evaluate/determination')
    .send({ programs: ['snap'], members: [] })
  assert.equal(det.status, 200)
  assert.ok(Array.isArray(det.body.determinations))

  for (const tail of ['/evaluate/expedited-screening', '/evaluate/medicaid-ex-parte']) {
    const res = await request(app).post(`/v2/eligibility${tail}`).send({})
    assert.equal(res.status, 501, `${tail} should still be a stub`)
    assert.match(res.body.detail, new RegExp(`/v1/eligibility${tail}`))
  }
})

test('three Swagger UIs coexist without clobbering each other', async () => {
  const v2 = await request(app).get('/v2/eligibility/docs/swagger-ui-init.js')
  const v1 = await request(app).get('/v1/eligibility/docs/swagger-ui-init.js')
  assert.match(v2.text, /engine-shaped/i)
  assert.doesNotMatch(v1.text, /engine-shaped/i)
})
