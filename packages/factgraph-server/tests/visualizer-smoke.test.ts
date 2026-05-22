/**
 * Smoke test: load a known ruleset, run a known input through the executor,
 * assert known outputs.
 *
 * This is a tripwire for accidental behavior changes in
 * `rules-visualizer-factgraph-core` — any shared-library edit that changes
 * what the visualizer's `/api/rulesets/:id/execute` would return will fail
 * here before it can ship.
 *
 * Uses the canonical SNAP-FY2026 test fixtures so the assertions track the
 * cases the rule authors already document.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  loadFactGraphData,
  getRuleset,
  getRawFacts,
  executeFactGraph,
} from 'rules-visualizer-factgraph-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '..', '..', '..', 'data', 'factgraph')
const RULESET_ID = 'snap-fy2026'

type Fixture = {
  id: string
  name: string
  inputs: Record<string, unknown>
  entities: Record<string, Record<string, unknown>[]>
  expect: Record<string, unknown>
}

loadFactGraphData(DATA_DIR)

const fixturesPath = path.join(DATA_DIR, RULESET_ID, 'tests.json')
const fixtures: Fixture[] = JSON.parse(fs.readFileSync(fixturesPath, 'utf-8'))

const model = getRuleset(RULESET_ID)
const facts = getRawFacts(RULESET_ID)

test('ruleset loaded', () => {
  assert.ok(model, `${RULESET_ID} should have loaded`)
  assert.ok(facts && facts.length > 0, 'facts array should be non-empty')
})

// Pick the first few cases as the smoke set. We're not trying to cover every
// scenario — that's what the simulation system is for. We're trying to catch
// "the executor returns something completely different than it used to."
const SMOKE_CASE_COUNT = 3

for (const fixture of fixtures.slice(0, SMOKE_CASE_COUNT)) {
  test(`execute ${fixture.id}: ${fixture.name}`, () => {
    assert.ok(model && facts)
    const results = executeFactGraph(
      RULESET_ID,
      facts,
      fixture.inputs,
      model.nodes as Record<string, { content: { dataType?: string } }>,
      fixture.entities
    )

    for (const [path, expected] of Object.entries(fixture.expect)) {
      const actual = results[path]
      assert.deepEqual(
        actual,
        expected,
        `${fixture.id}: expected ${path} = ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
      )
    }
  })
}
