/**
 * The v2 engine-shaped contract: served publicly, path-free, and matching the
 * implemented endpoints — per-program (snap, medicaid), friendly request,
 * per-determination response, and missingInputs in the request vocabulary.
 * /snap/expedited-screening is implemented; only /medicaid/ex-parte is still
 * a 501 stub.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

import { app } from './helpers.js'
import { V2_API_VERSION } from '../src/v2-openapi.js'

test('v2 spec is served unauthenticated and labeled the engine-shaped contract', async () => {
  const res = await request(app).get('/v2/eligibility/openapi.json')
  assert.equal(res.status, 200)
  assert.match(res.body.openapi, /^3\.1/)
  assert.match(res.body.info.title, /v2/)
  assert.match(res.body.info.title, /engine-shaped/i)
  assert.equal(res.body.info.version, V2_API_VERSION)
  assert.match(res.body.info.description, /no-guess/i)
})

test('v2 spec carries the implemented request/response shape', async () => {
  const res = await request(app).get('/v2/eligibility/openapi.json')
  const schemas = res.body.components.schemas

  // Friendly request schemas.
  for (const name of ['HouseholdRequest', 'Member', 'IncomeRow', 'CaregiverRelationship']) {
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
  assert.deepEqual(
    det.status.enum,
    ['approved', 'denied', 'ineligible', 'pending'],
    'every documented status is reachable (not_supported was dead vocabulary)'
  )
  assert.ok(schemas.DeterminationResponse.properties.determinations)

  // missingInputs is in the friendly request vocabulary.
  const mi = schemas.MissingInput.properties
  assert.ok(mi.requestPath && mi.field && mi.location && mi.label)

  // Both program paths are registered.
  const snapPath = res.body.paths['/v2/eligibility/snap/determination']
  const medicaidPath = res.body.paths['/v2/eligibility/medicaid/determination']
  assert.ok(snapPath, 'SNAP determination path registered')
  assert.ok(medicaidPath, 'Medicaid determination path registered')

  const snap200 = snapPath.post.responses['200']
  assert.equal(snap200.content['application/json'].schema.oneOf, undefined, 'no oneOf union')
  assert.match(snap200.content['application/json'].schema.$ref, /DeterminationResponse/)
})

test('v2 request bodies ship determination examples', async () => {
  const res = await request(app).get('/v2/eligibility/openapi.json')
  const snapExamples =
    res.body.paths['/v2/eligibility/snap/determination'].post.requestBody
      .content['application/json'].examples
  assert.ok(Object.values(snapExamples).length > 0, 'SNAP endpoint has examples')

  const medicaidExamples =
    res.body.paths['/v2/eligibility/medicaid/determination'].post.requestBody
      .content['application/json'].examples
  assert.ok(Object.values(medicaidExamples).length > 0, 'Medicaid endpoint has examples')
})

test('v2 spec is path-free (no rules-engine internals)', async () => {
  const res = await request(app).get('/v2/eligibility/openapi.yaml')
  assert.ok(!/\/members\/\*/.test(res.text), 'leaked a /members/* path')
  assert.ok(!/eligibilityCategory|x-trace|TraceNode/.test(res.text), 'leaked engine internals')
})

test('per-program determination and expedited-screening endpoints are implemented; only medicaid/ex-parte is a 501 stub', async () => {
  const snap = await request(app)
    .post('/v2/eligibility/snap/determination')
    .send({ members: [] })
  assert.equal(snap.status, 200)
  assert.ok(Array.isArray(snap.body.determinations))

  const medicaid = await request(app)
    .post('/v2/eligibility/medicaid/determination')
    .send({ members: [] })
  assert.equal(medicaid.status, 200)
  assert.ok(Array.isArray(medicaid.body.determinations))

  const snapExpedited = await request(app).post('/v2/eligibility/snap/expedited-screening').send({})
  assert.equal(snapExpedited.status, 200, 'expedited-screening is implemented, not a stub')

  const medicaidExParte = await request(app).post('/v2/eligibility/medicaid/ex-parte').send({})
  assert.equal(medicaidExParte.status, 501)
  assert.match(medicaidExParte.body.detail, /\/v1\/eligibility\/evaluate\/medicaid-ex-parte/)
})

test('three Swagger UIs coexist without clobbering each other', async () => {
  const v2 = await request(app).get('/v2/eligibility/docs/swagger-ui-init.js')
  const v1 = await request(app).get('/v1/eligibility/docs/swagger-ui-init.js')
  assert.match(v2.text, /engine-shaped/i)
  assert.doesNotMatch(v1.text, /engine-shaped/i)
})
