import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

import { app } from './helpers.js'

test('GET /health returns 200 OK', async () => {
  const res = await request(app).get('/health')
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { status: 'ok' })
})

test('GET /health is unauthenticated even when bearer token is configured', async () => {
  const original = process.env.API_BEARER_TOKEN
  process.env.API_BEARER_TOKEN = 'some-test-token'
  try {
    const res = await request(app).get('/health')
    assert.equal(res.status, 200)
  } finally {
    if (original === undefined) delete process.env.API_BEARER_TOKEN
    else process.env.API_BEARER_TOKEN = original
  }
})
