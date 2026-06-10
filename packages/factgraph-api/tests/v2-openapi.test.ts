/**
 * The v2 draft-proposal contract: served publicly, clearly labeled draft,
 * path-free, and actually carrying the proposal's deltas (no-guess fields,
 * medicaid cardinality, first-class amounts, ex_parte/not_supported states).
 * The evaluate endpoints are 501 stubs pointing at v1.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

import { app } from './helpers.js'

test('v2 spec is served unauthenticated and labeled a draft', async () => {
  const res = await request(app).get('/v2/eligibility/openapi.json')
  assert.equal(res.status, 200)
  assert.match(res.body.openapi, /^3\.1/)
  assert.match(res.body.info.title, /v2 draft proposal/)
  assert.match(res.body.info.version, /draft/)
  assert.match(res.body.info.description, /draft proposal/i)
})

test('v2 spec carries the proposal deltas', async () => {
  const res = await request(app).get('/v2/eligibility/openapi.json')
  const schemas = res.body.components.schemas

  // Request can carry the no-guess fields.
  for (const name of [
    'Pregnancy', 'VeteranStatus', 'StudentStatus', 'DisabilityDetails',
    'LivingSituation', 'WorkRequirements', 'ImmigrationDetails', 'Findings',
    'ApplicationContext', 'CaregiverRelationship',
  ]) {
    assert.ok(schemas[name], `expected schema ${name}`)
  }

  // Response expresses the outcome: first-class fields, no x- prefixes.
  const decision = schemas.ProgramDecision.properties
  assert.ok(decision.benefitAmount, 'benefitAmount should be first-class')
  assert.ok(decision.missingInformation, 'missingInformation should be first-class')
  assert.equal(decision['x-allotment'], undefined)

  // Explicit states.
  assert.ok(decision.status.enum.includes('not_supported'))
  assert.ok(decision.path.enum.includes('ex_parte'))

  // Medicaid cardinality: household-shaped request with subjectMemberId,
  // per-member response, and an ex parte request requiring household.
  assert.ok(schemas.DeterminationRequest.properties.subjectMemberId)
  assert.ok(schemas.MemberDeterminationResponse.properties.decisions)
  assert.ok(schemas.MedicaidExParteRequest.properties.household)
  assert.ok(schemas.MedicaidExParteRequest.required.includes('household'))

  // Proposed serviceResult shapes exist and say so.
  assert.match(schemas.FdshFtiResult.description, /PROPOSED/)
})

test('v2 spec is path-free (no rules-engine internals)', async () => {
  const res = await request(app).get('/v2/eligibility/openapi.yaml')
  assert.ok(!/\/members\/\*/.test(res.text), 'leaked a /members/* path')
  assert.ok(!/eligibilityCategory|x-trace|TraceNode/.test(res.text), 'leaked engine internals')
})

test('v2 evaluate endpoints are 501 stubs pointing at v1', async () => {
  const res = await request(app)
    .post('/v2/eligibility/evaluate/determination')
    .send({ program: 'snap' })
  assert.equal(res.status, 501)
  assert.match(res.body.detail, /\/v1\/eligibility\/evaluate\/determination/)
})

test('three Swagger UIs coexist without clobbering each other', async () => {
  const v2 = await request(app).get('/v2/eligibility/docs/swagger-ui-init.js')
  const v1 = await request(app).get('/v1/eligibility/docs/swagger-ui-init.js')
  assert.match(v2.text, /v2 draft proposal/)
  assert.doesNotMatch(v1.text, /v2 draft proposal/)
})
