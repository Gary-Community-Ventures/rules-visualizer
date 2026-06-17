/**
 * Guards for docs/engine-inputs.json — the canonical engine-input catalog the
 * partner builds their data model against:
 *  1. Drift — the committed file matches what the generator produces, so a
 *     rule change (new input, renamed enum value, edited definition) that
 *     isn't regenerated fails CI.
 *  2. Shape — every field carries the metadata a consumer needs.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import './helpers.js'
import { renderEngineInputs, buildEngineInputs } from '../scripts/generate-engine-inputs.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.resolve(__dirname, '..', 'docs', 'engine-inputs.json')

test('engine-inputs.json is in sync with the generator', () => {
  const committed = readFileSync(FILE, 'utf-8')
  assert.equal(
    committed,
    renderEngineInputs(),
    'docs/engine-inputs.json is stale — run `npm run gen:engine-inputs`'
  )
})

test('every field has the metadata a consumer needs', () => {
  const doc = buildEngineInputs()
  assert.ok(doc.groups.length > 0, 'expected at least one group')
  for (const group of doc.groups) {
    for (const f of group.fields) {
      assert.ok(f.field, 'field name')
      assert.ok(['applicant', 'derived', 'reference'].includes(f.kind), `kind for ${f.field}`)
      assert.ok(typeof f.type === 'string' && f.type.length > 0, `type for ${f.field}`)
      assert.ok(Array.isArray(f.programs), `programs for ${f.field}`)
      assert.ok(Array.isArray(f.citations), `citations for ${f.field}`)
      // No retired conformance vocabulary leaks into the catalog.
      assert.ok(!('source' in f), `${f.field} must not carry the retired source tag`)
      assert.ok(!('supersededBy' in f), `${f.field} must not carry supersededBy`)
    }
  }
})

test('catalog covers both programs and drops compat-only carryovers', () => {
  const doc = buildEngineInputs()
  const all = doc.groups.flatMap((g) => g.fields)
  assert.ok(all.some((f) => f.programs.includes('SNAP')), 'has SNAP inputs')
  assert.ok(all.some((f) => f.programs.includes('Medicaid')), 'has Medicaid inputs')
  // derived fields explain their derivation; applicant fields don't need one.
  for (const f of all.filter((f) => f.kind === 'derived')) {
    assert.ok(f.derivation, `derived field ${f.field} should explain its derivation`)
  }
})
