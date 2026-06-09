/**
 * The consumer-facing eligibility contract is a separate, public, path-free
 * OpenAPI document. These tests pin the three things the partner asked for:
 * it's separate (only /v1/eligibility/* paths), readable without auth, and
 * exposes no Fact Graph paths/targets/traces anywhere.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

import { app } from './helpers.js'

test('consumer OpenAPI is served unauthenticated as valid 3.1', async () => {
  const res = await request(app).get('/v1/eligibility/openapi.json')
  assert.equal(res.status, 200)
  assert.match(res.body.openapi, /^3\.1/)
  assert.equal(res.body.info.title, 'Eligibility Adapter API')
})

test('consumer spec contains only the eligibility endpoints', async () => {
  const res = await request(app).get('/v1/eligibility/openapi.json')
  const paths = Object.keys(res.body.paths)
  assert.deepEqual(
    paths.sort(),
    [
      '/v1/eligibility/evaluate/determination',
      '/v1/eligibility/evaluate/expedited-screening',
      '/v1/eligibility/evaluate/medicaid-ex-parte',
    ]
  )
  // No generic FactGraph query/schema endpoints leaked into the consumer doc.
  assert.ok(!paths.some((p) => p.includes('/factgraph')))
})

test('consumer spec exposes no Fact Graph paths, targets, or traces', async () => {
  const res = await request(app).get('/v1/eligibility/openapi.yaml')
  const text = res.text
  // Fact Graph paths look like /members/*/... or /eligibilityCategory etc.
  assert.ok(!/\/members\/\*/.test(text), 'leaked a /members/* path')
  assert.ok(!/eligibilityCategory|isExpedited|\/allotment\b/.test(text), 'leaked a target path')
  assert.ok(!/x-trace|x-decidingPath|TraceNode/.test(text), 'leaked trace internals')
})

test('the determination request ships a representative example', async () => {
  const res = await request(app).get('/v1/eligibility/openapi.json')
  const schema = res.body.components.schemas.HouseholdDeterminationRequest
  assert.ok(schema.example, 'expected a representative example on the request schema')
  assert.equal(schema.example.members[0].id, 'head')
})
