import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import yaml from 'yaml'

import { app, withEnv } from './helpers.js'

const JSON_PATH = '/v1/factgraph/openapi.json'
const YAML_PATH = '/v1/factgraph/openapi.yaml'
const DOCS_PATH = '/v1/factgraph/docs/'

test('GET /openapi.json returns a valid OpenAPI 3.1 document', async () => {
  const res = await request(app).get(JSON_PATH)
  assert.equal(res.status, 200)
  assert.equal(res.body.openapi, '3.1.0')
  assert.equal(res.body.info.title, 'Factgraph API')
  // Paths are registered.
  assert.ok(res.body.paths['/v1/factgraph/{rulesetId}/query'])
  assert.ok(res.body.paths['/v1/factgraph/rulesets'])
  assert.ok(res.body.paths['/v1/factgraph/{rulesetId}/schema'])
  assert.ok(res.body.paths['/health'])
  // Component schemas are present.
  assert.ok(res.body.components.schemas.QueryRequest)
  assert.ok(res.body.components.schemas.QueryResponse)
  assert.ok(res.body.components.schemas.MissingInput)
  assert.ok(res.body.components.schemas.ProblemDetails)
  // Bearer auth security scheme.
  assert.equal(
    res.body.components.securitySchemes.bearerAuth.scheme,
    'bearer'
  )
})

test('GET /openapi.yaml returns the same document in YAML', async () => {
  const res = await request(app).get(YAML_PATH)
  assert.equal(res.status, 200)
  assert.match(res.headers['content-type'] ?? '', /yaml/)
  const parsed = yaml.parse(res.text)
  assert.equal(parsed.openapi, '3.1.0')
  assert.equal(parsed.info.title, 'Factgraph API')
})

test('GET /docs renders Swagger UI HTML', async () => {
  const res = await request(app).get(DOCS_PATH)
  assert.equal(res.status, 200)
  assert.match(res.text, /<title>Factgraph API — docs<\/title>/)
  assert.match(res.text, /swagger-ui/)
})

test('OpenAPI endpoints are exempt from bearer auth', async () => {
  await withEnv('API_BEARER_TOKEN', 'enforced-token', async () => {
    // /v1/factgraph/rulesets should 401 — sanity check that auth is on.
    const rulesetsRes = await request(app).get('/v1/factgraph/rulesets')
    assert.equal(
      rulesetsRes.status,
      401,
      'auth must be enforced for the sanity check to be meaningful'
    )

    // OpenAPI endpoints should still 200 without a token.
    for (const path of [JSON_PATH, YAML_PATH, DOCS_PATH]) {
      const res = await request(app).get(path)
      assert.equal(
        res.status,
        200,
        `${path} should be exempt from auth, got ${res.status}`
      )
    }
  })
})

test('OpenAPI spec documents the production server URL', async () => {
  const res = await request(app).get(JSON_PATH)
  const serverUrls = (res.body.servers as { url: string }[]).map((s) => s.url)
  assert.ok(
    serverUrls.some((u) => u.includes('herokuapp.com')),
    'production Heroku URL should appear in servers list'
  )
  assert.ok(
    serverUrls.some((u) => u.includes('localhost:5002')),
    'local dev URL should appear in servers list'
  )
})

test('QueryRequest schema in the spec matches the runtime Zod shape', async () => {
  const res = await request(app).get(JSON_PATH)
  const schema = res.body.components.schemas.QueryRequest
  assert.ok(schema.properties)
  // The wire contract: targets is required, others optional.
  assert.deepEqual(schema.required, ['targets'])
  assert.equal(schema.properties.targets.type, 'array')
  assert.ok(schema.properties.inputs)
  assert.ok(schema.properties.include)
  assert.ok(schema.properties.metadata)
  // entities was merged into inputs; should NOT be a top-level field.
  assert.equal(schema.properties.entities, undefined)
})
