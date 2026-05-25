import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

import { app, withEnv } from './helpers.js'

const ENDPOINT = '/v1/factgraph/rulesets'

test('with API_BEARER_TOKEN unset, requests pass without auth header', async () => {
  await withEnv('API_BEARER_TOKEN', undefined, async () => {
    const res = await request(app).get(ENDPOINT)
    assert.equal(res.status, 200)
  })
})

test('with API_BEARER_TOKEN set, missing Authorization → 401', async () => {
  await withEnv('API_BEARER_TOKEN', 'expected-token', async () => {
    const res = await request(app).get(ENDPOINT)
    assert.equal(res.status, 401)
    assert.equal(res.body.type, 'https://tools.ietf.org/html/rfc9457')
    assert.equal(res.body.status, 401)
  })
})

test('with API_BEARER_TOKEN set, malformed header (no Bearer) → 401', async () => {
  await withEnv('API_BEARER_TOKEN', 'expected-token', async () => {
    const res = await request(app)
      .get(ENDPOINT)
      .set('Authorization', 'expected-token') // missing "Bearer " prefix
    assert.equal(res.status, 401)
  })
})

test('with API_BEARER_TOKEN set, wrong token → 401', async () => {
  await withEnv('API_BEARER_TOKEN', 'expected-token', async () => {
    const res = await request(app)
      .get(ENDPOINT)
      .set('Authorization', 'Bearer wrong-token')
    assert.equal(res.status, 401)
  })
})

test('with API_BEARER_TOKEN set, correct token → 200', async () => {
  await withEnv('API_BEARER_TOKEN', 'expected-token', async () => {
    const res = await request(app)
      .get(ENDPOINT)
      .set('Authorization', 'Bearer expected-token')
    assert.equal(res.status, 200)
  })
})

test('with API_BEARER_TOKEN set, /health stays unauthenticated', async () => {
  await withEnv('API_BEARER_TOKEN', 'expected-token', async () => {
    const res = await request(app).get('/health')
    assert.equal(res.status, 200)
  })
})
