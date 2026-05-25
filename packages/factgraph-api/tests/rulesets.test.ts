import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

import { app, RULESET_ID } from './helpers.js'

test('GET /v1/factgraph/rulesets lists loaded rulesets', async () => {
  const res = await request(app).get('/v1/factgraph/rulesets')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.rulesets))
  const ids = res.body.rulesets.map((r: { id: string }) => r.id)
  assert.ok(ids.includes(RULESET_ID), 'snap-fy2026 should be in the list')
  // Every entry has the documented shape.
  for (const entry of res.body.rulesets) {
    assert.equal(typeof entry.id, 'string')
    assert.equal(typeof entry.name, 'string')
    assert.equal(entry.format, 'factGraph')
  }
})

test('GET /v1/factgraph/:rulesetId/schema returns model for a known ruleset', async () => {
  const res = await request(app).get(`/v1/factgraph/${RULESET_ID}/schema`)
  assert.equal(res.status, 200)
  assert.equal(res.body.id, RULESET_ID)
  assert.equal(res.body.format, 'factGraph')
  assert.ok(typeof res.body.nodes === 'object' && res.body.nodes !== null)
  // Spot-check that a known SNAP fact is present.
  const paths = new Set(
    Object.values(res.body.nodes).map(
      (n: { content?: { path?: string } }) => n.content?.path
    )
  )
  assert.ok(paths.has('/eligible'))
  assert.ok(paths.has('/snap'))
})

test('GET schema for unknown ruleset → 404 Problem Details', async () => {
  const res = await request(app).get('/v1/factgraph/does-not-exist/schema')
  assert.equal(res.status, 404)
  assert.equal(res.body.type, 'https://tools.ietf.org/html/rfc9457')
  assert.equal(res.body.status, 404)
  assert.match(res.body.detail, /does-not-exist/)
})
