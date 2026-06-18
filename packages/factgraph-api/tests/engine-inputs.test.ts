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

test('every field is keyed by its real path and carries consumer metadata', () => {
  const doc = buildEngineInputs()
  assert.ok(doc.groups.length > 0, 'expected at least one group')
  for (const group of doc.groups) {
    for (const f of group.fields) {
      // Identity is the Fact Graph path, never a reconstructed short name.
      assert.ok(f.path && f.path.startsWith('/'), `path for ${JSON.stringify(f)}`)
      assert.ok(f.name && f.name.length > 0, `name for ${f.path}`)
      assert.ok(['applicant', 'reference'].includes(f.kind), `kind for ${f.path}`)
      assert.ok(typeof f.type === 'string' && f.type.length > 0, `type for ${f.path}`)
      assert.ok(Array.isArray(f.programs) && f.programs.length > 0, `programs for ${f.path}`)
      assert.ok(Array.isArray(f.citations), `citations for ${f.path}`)
      // No retired ORCA-mapping vocabulary leaks into the rules-faithful catalog.
      assert.ok(!('source' in f), `${f.path} must not carry the retired source tag`)
      assert.ok(!('field' in f), `${f.path} must be keyed by path, not an ORCA field name`)
    }
  }
})

test('catalog covers both programs from their own writables', () => {
  const all = buildEngineInputs().groups.flatMap((g) => g.fields)
  assert.ok(all.some((f) => f.programs.includes('SNAP')), 'has SNAP inputs')
  assert.ok(all.some((f) => f.programs.includes('Medicaid')), 'has Medicaid inputs')
  // Cross-references (member links) are tagged reference, not applicant values.
  const spouse = all.find((f) => f.path === '/members/*/spouseId')
  assert.ok(spouse && spouse.kind === 'reference', 'spouseId is a reference')
})
