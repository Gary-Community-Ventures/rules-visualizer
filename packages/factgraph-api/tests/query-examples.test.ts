/**
 * Guards for the committed query examples in docs/examples/:
 *  1. Drift — each committed blob matches what the generator produces.
 *  2. Resolution — each blob still runs through the engine to a complete
 *     determination, so a rule change that breaks an example fails CI.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getRuleset, getRawFacts } from 'rules-visualizer-factgraph-core'

// helpers.js loads the fact-graph data dir as a side effect.
import './helpers.js'
import { runQuery } from '../src/evaluate.js'
import { EXAMPLE_NAMES, renderExample } from '../scripts/generate-query-examples.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(__dirname, '..', 'docs', 'examples')

for (const name of EXAMPLE_NAMES) {
  test(`example ${name} is in sync with the generator`, () => {
    const committed = readFileSync(path.join(dir, name), 'utf-8')
    assert.equal(
      committed,
      renderExample(name),
      `docs/examples/${name} is stale — run \`npm run gen:examples\``
    )
  })

  test(`example ${name} resolves to a complete determination`, () => {
    const blob = JSON.parse(readFileSync(path.join(dir, name), 'utf-8'))
    const model = getRuleset('snap-complete')!
    const facts = getRawFacts('snap-complete')!
    const r = runQuery('snap-complete', model, facts, {
      targets: blob.targets,
      inputs: blob.inputs,
    })
    assert.ok(r.ok, `${name}: unknown targets`)
    assert.equal(r.response.status, 'complete', `${name}: did not fully resolve`)
  })
}
