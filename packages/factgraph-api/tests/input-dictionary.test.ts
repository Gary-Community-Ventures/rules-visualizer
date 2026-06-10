/**
 * Input dictionary guards.
 *
 * 1. Drift: the committed docs/input-dictionary.md must match what the
 *    generator produces from the field map + the rulesets.
 * 2. Completeness: every writable input in snap-complete AND medicaid must
 *    be covered by the field map (or be a known structural exception) — so
 *    if a rule author adds an input, this test fails until the API contract
 *    learns how to carry it. This is the executable form of "every graph
 *    input is expressible through the v2 request."
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getRuleset } from 'rules-visualizer-factgraph-core'
import type { ModelNode } from 'rules-visualizer-shared-types'

// helpers.js side-effect: loads the fact-graph data directory.
import './helpers.js'
import {
  renderInputDictionary,
  mappedPaths,
  STRUCTURAL_UNMAPPED,
} from '../scripts/generate-input-dictionary.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test('committed input-dictionary.md matches the generator output', () => {
  const committed = readFileSync(
    path.resolve(__dirname, '..', 'docs', 'input-dictionary.md'),
    'utf-8'
  )
  assert.equal(
    committed,
    renderInputDictionary(),
    'docs/input-dictionary.md is stale — run `npm run gen:dictionary`'
  )
})

function writablePaths(rulesetId: string): string[] {
  const model = getRuleset(rulesetId)
  assert.ok(model, `${rulesetId} should be loaded`)
  const out: string[] = []
  for (const node of Object.values(model.nodes) as ModelNode[]) {
    const c = node.content
    if (c.type !== 'writable' || !('path' in c)) continue
    // Collection roots are containers, not value inputs.
    if ((c as { typeName?: string }).typeName === 'Collection') continue
    out.push(c.path)
  }
  return out
}

test('field map covers every writable input in both rulesets', () => {
  const { snap, medicaid } = mappedPaths()

  const uncoveredSnap = writablePaths('snap-complete').filter(
    (p) => !snap.has(p) && !STRUCTURAL_UNMAPPED.has(p)
  )
  assert.deepEqual(
    uncoveredSnap,
    [],
    'snap-complete inputs missing from the v2 field map'
  )

  const uncoveredMedicaid = writablePaths('medicaid').filter(
    (p) => !medicaid.has(p) && !STRUCTURAL_UNMAPPED.has(p)
  )
  assert.deepEqual(
    uncoveredMedicaid,
    [],
    'medicaid inputs missing from the v2 field map'
  )
})
