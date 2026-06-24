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
import { renderEngineInputs, buildEngineInputs, DICTIONARY_SCHEMA_VERSION } from '../scripts/generate-engine-inputs.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.resolve(__dirname, '..', 'docs', 'engine-inputs.json')

test('catalog carries a schemaVersion matching DICTIONARY_SCHEMA_VERSION', () => {
  const doc = buildEngineInputs()
  assert.ok(typeof doc.schemaVersion === 'string' && doc.schemaVersion.length > 0, 'schemaVersion present')
  assert.equal(doc.schemaVersion, DICTIONARY_SCHEMA_VERSION)
  // Confirm it also landed in the committed file.
  const committed = JSON.parse(readFileSync(FILE, 'utf-8'))
  assert.equal(committed.schemaVersion, DICTIONARY_SCHEMA_VERSION)
})

test('engine-inputs.json is in sync with the generator', () => {
  const committed = readFileSync(FILE, 'utf-8')
  assert.equal(
    committed,
    renderEngineInputs(),
    'docs/engine-inputs.json is stale — run `npm run gen:engine-inputs`'
  )
})

test('every field is presented as the consumer sends it (friendly field + location)', () => {
  const doc = buildEngineInputs()
  assert.ok(doc.groups.length > 0, 'expected at least one group')
  for (const group of doc.groups) {
    for (const f of group.fields) {
      // The consumer-facing identity is field + location, never a raw path.
      assert.ok(f.field && !f.field.includes('/'), `field for ${JSON.stringify(f)}`)
      assert.ok(f.location && !f.location.includes('*'), `location for ${f.field}`)
      assert.ok(f.name && f.name.length > 0, `name for ${f.field}`)
      assert.ok(['applicant', 'reference', 'derived'].includes(f.kind), `kind for ${f.field}`)
      assert.ok(typeof f.type === 'string' && f.type.length > 0, `type for ${f.field}`)
      assert.ok(Array.isArray(f.programs) && f.programs.length > 0, `programs for ${f.field}`)
      assert.ok(Array.isArray(f.citations), `citations for ${f.field}`)
      // The engine path rides along for traceability but isn't the identity.
      assert.ok(f.enginePath && f.enginePath.startsWith('/'), `enginePath for ${f.field}`)
    }
  }
})

test('catalog covers both programs and presents friendly identities', () => {
  const all = buildEngineInputs().groups.flatMap((g) => g.fields)
  assert.ok(all.some((f) => f.programs.includes('SNAP')), 'has SNAP inputs')
  assert.ok(all.some((f) => f.programs.includes('Medicaid')), 'has Medicaid inputs')
  // A member flag shows as members[].<field>, not /members/*/...
  const disability = all.find((f) => f.enginePath === '/members/*/hasPhysicalDisability')
  assert.ok(disability, 'has the physical-disability field')
  assert.equal(disability!.location, 'members[]')
  assert.equal(disability!.field, 'hasPhysicalDisability')
  // Cross-references are tagged reference; nested sub-collections' memberId
  // back-links are implied (nesting) and omitted from the catalog.
  const spouse = all.find((f) => f.enginePath === '/members/*/spouseId')
  assert.ok(spouse && spouse.kind === 'reference', 'spouseId is a reference')
  // The age writable is exposed as a derived dateOfBirth (a raw age goes stale).
  const age = all.find((f) => f.enginePath === '/members/*/age')
  assert.ok(age && age.kind === 'derived' && age.field === 'dateOfBirth', 'age → dateOfBirth (derived)')
  assert.ok(age!.derivation, 'derived field explains its derivation')
  assert.ok(
    !all.some((f) => f.location === 'members[].income[]' && f.field === 'memberId'),
    'implied income memberId back-link is not a consumer field'
  )
})
