/**
 * Direct unit coverage for the per-model index cache. The query-route
 * tests cover the integration; these confirm the cache contract.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getRuleset } from 'rules-visualizer-factgraph-core'

import { getModelIndex } from '../src/model-index.js'

// helpers.ts loads the data dir at import time.
import { RULESET_ID } from './helpers.js'

function model() {
  const m = getRuleset(RULESET_ID)
  if (!m) throw new Error(`${RULESET_ID} not loaded`)
  return m
}

test('getModelIndex caches by Model identity', () => {
  const m = model()
  const a = getModelIndex(m)
  const b = getModelIndex(m)
  assert.equal(a, b, 'second call should return the same index instance')
  // And the inner Maps should be the same instances too — defensive
  // against an accidental copy in the lookup.
  assert.equal(a.pathToNode, b.pathToNode)
  assert.equal(a.reverseDeps, b.reverseDeps)
})

test('pathToNode resolves every fact in the ruleset', () => {
  const m = model()
  const index = getModelIndex(m)
  for (const node of Object.values(m.nodes)) {
    const c = node.content
    if (c.type === 'entity' || !('path' in c)) continue
    assert.equal(
      index.pathToNode.get(c.path),
      node,
      `pathToNode missing entry for ${c.path}`
    )
  }
})

test('reverseDeps inverts the dependency graph', () => {
  const m = model()
  const index = getModelIndex(m)
  // Sanity: for every dep edge in the forward direction, the reverse
  // map should contain the consumer.
  for (const node of Object.values(m.nodes)) {
    for (const depId of node.dependencies) {
      const consumers = index.reverseDeps.get(depId) ?? []
      assert.ok(
        consumers.includes(node.id),
        `reverseDeps[${depId}] should include consumer ${node.id}`
      )
    }
  }
})

test('collectionRoots discovers /members for the SNAP ruleset', () => {
  const index = getModelIndex(model())
  assert.ok(
    index.collectionRoots.has('/members'),
    `expected /members in collectionRoots; got ${[...index.collectionRoots].join(', ') || '(none)'}`
  )
})

test('collectionRootSeeds groups every per-member fact under its root', () => {
  const index = getModelIndex(model())
  const seeds = index.collectionRootSeeds.get('/members')
  assert.ok(seeds, '/members should have a seed bucket')
  // Every seed node should live under /members.
  for (const node of seeds!) {
    const c = node.content
    assert.ok(
      c.type !== 'entity' && 'path' in c,
      'seed should be a path-bearing node'
    )
    if (c.type !== 'entity' && 'path' in c) {
      assert.ok(
        c.path === '/members' || c.path.startsWith('/members/'),
        `seed ${c.path} should live under /members`
      )
    }
  }
  // And every per-member path-bearing node in the model should appear
  // in the seed bucket (no orphans).
  const seedIds = new Set(seeds!.map((n) => n.id))
  for (const node of Object.values(model().nodes)) {
    const c = node.content
    if (c.type === 'entity' || !('path' in c)) continue
    if (c.path === '/members' || c.path.startsWith('/members/')) {
      assert.ok(
        seedIds.has(node.id),
        `node ${node.id} (${c.path}) should be in /members seeds`
      )
    }
  }
})
