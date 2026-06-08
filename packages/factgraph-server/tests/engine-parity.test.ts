/**
 * Cross-engine parity: the Rust `factgraph-rs` WASM engine (our default,
 * `executor-rs.ts`) must agree with the Scala.js reference bundle
 * (`executor.ts`) on the same inputs. We author and own the Rust engine,
 * so this is the tripwire that catches it diverging from the upstream
 * IRS Direct File runtime on a real ruleset.
 *
 * It also pins the behavior of `<CollectionItem>` member references
 * (`/incomes/*\/memberId` → `/members`), which is where a divergence was
 * once suspected: a reference resolves by POSITION (`#N`, or the numeric
 * index the saved fixtures use), never by an arbitrary caller id-string.
 * Both engines treat an unresolvable reference the same way — the row
 * attaches to no member. This test makes that contract explicit and
 * regression-proof on both runtimes.
 *
 * Imports both executor modules directly by source path: only one is on
 * the package's public surface at a time (`index.ts` re-exports the
 * active one), but a parity test inherently needs both.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  loadFactGraphData,
  getRawFacts,
  getRuleset,
} from 'rules-visualizer-factgraph-core'
import { executeFactGraph as execRust } from '../../factgraph-core/src/executor-rs.js'
import { executeFactGraph as execScala } from '../../factgraph-core/src/executor.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '..', '..', '..', 'data', 'factgraph')
const RULESET_ID = 'snap-complete'

loadFactGraphData(DATA_DIR)

type Fixture = {
  id: string
  name?: string
  inputs: Record<string, unknown>
  entities: Record<string, Record<string, unknown>[]>
  expect: Record<string, unknown>
}

const facts = getRawFacts(RULESET_ID)!
const nodes = getRuleset(RULESET_ID)!.nodes as Record<
  string,
  { content: { dataType?: string } }
>
const fixtures: Fixture[] = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, RULESET_ID, 'tests.json'), 'utf-8')
)

function run(
  exec: typeof execRust,
  inputs: Record<string, unknown>,
  entities: Record<string, Record<string, unknown>[]>,
  readPaths: string[]
): Record<string, unknown> {
  return exec(RULESET_ID, facts, inputs, nodes, entities, new Set(readPaths))
}

// We only need cases that actually exercise an income (so member-reference
// resolution is observable). Cap the count to keep the suite fast — this is
// a parity tripwire, not exhaustive coverage (the simulation system does that).
const PARITY_CASES = fixtures
  .filter((f) => f.entities?.['/incomes']?.length)
  .slice(0, 8)

for (const fixture of PARITY_CASES) {
  test(`rust and scala agree on ${fixture.id.slice(0, 8)} (${fixture.name ?? ''})`, () => {
    const readPaths = Object.keys(fixture.expect)
    const rust = run(execRust, fixture.inputs, fixture.entities, readPaths)
    const scala = run(execScala, fixture.inputs, fixture.entities, readPaths)
    for (const p of readPaths) {
      assert.deepEqual(
        rust[p],
        scala[p],
        `engine divergence on ${p}: rust=${JSON.stringify(rust[p])} scala=${JSON.stringify(scala[p])}`
      )
    }
  })
}

test('member references resolve positionally and identically across engines', () => {
  // Anchor on the canonical eligible applicant (snap-complete "Default"
  // profile): a single working member with $1,200/mo wages attributed by
  // position (`#0`). With the income attached the household is eligible;
  // detach it and the outcome changes — so this scenario is sensitive to
  // member-reference resolution.
  const profiles: Array<{
    name: string
    inputs: Record<string, unknown>
    entities: Record<string, Record<string, unknown>[]>
  }> = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, RULESET_ID, 'profiles.json'), 'utf-8')
  )
  const base = profiles.find((p) => p.name === 'Default') ?? profiles[0]
  assert.ok(
    base?.entities?.['/incomes']?.length,
    'expected the Default profile to carry an income'
  )

  // Income-attribution-sensitive outputs — these flip when income detaches
  // from its member (gross income → eligibility category → allotment →
  // expedited screening).
  const readPaths = ['/eligibilityCategory', '/allotment', '/isExpedited']

  // Variant: rewrite every memberId cross-reference to an arbitrary
  // id-string. Neither engine resolves it (member identity is positional,
  // not by caller id) — so the income detaches from its member.
  const broken: Fixture['entities'] = JSON.parse(JSON.stringify(base.entities))
  for (const coll of Object.values(broken)) {
    for (const row of coll) {
      for (const key of Object.keys(row)) {
        if (key.endsWith('/memberId')) row[key] = 'not-a-positional-ref'
      }
    }
  }

  const rustBase = run(execRust, base.inputs, base.entities, readPaths)
  const scalaBase = run(execScala, base.inputs, base.entities, readPaths)
  const rustBroken = run(execRust, base.inputs, broken, readPaths)
  const scalaBroken = run(execScala, base.inputs, broken, readPaths)

  // The two engines agree in BOTH the resolved and the unresolvable case —
  // the divergence that was once suspected does not exist.
  assert.deepEqual(
    rustBase,
    scalaBase,
    'engines disagree on resolved references'
  )
  assert.deepEqual(
    rustBroken,
    scalaBroken,
    'engines disagree on unresolvable references'
  )

  // And the reference actually matters: detaching it changes at least one
  // output. (If this ever stops holding, the chosen fixture no longer
  // depends on member-attributed income and the test should pick another.)
  assert.notDeepEqual(
    rustBase,
    rustBroken,
    'expected the member reference to affect the outcome'
  )
})
