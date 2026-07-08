/**
 * Shared golden fixture: the snap-complete profile converted to the friendly
 * v2 request via the field index. Extracted from eligibility-v2-outcomes so
 * gate/regression tests can mutate the built request (drop a field, raise an
 * amount) without duplicating the conversion.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getRuleset } from 'rules-visualizer-factgraph-core'

import { indexForModel, snakeEnum, type FieldEntry } from '../src/translate/field-index.js'
import { SNAP_RULESET_ID } from '../src/translate/snap.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** The single known-good profile shipped with the snap-complete ruleset:
 *  `inputs` are engine-path scalars, `entities` are collections keyed by
 *  root with engine-path row fields. */
type EngineProfile = {
  inputs: Record<string, unknown>
  entities: Record<string, Array<Record<string, unknown>>>
}

export function loadProfile(): EngineProfile {
  const p = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'data',
    'factgraph',
    'snap-complete',
    'profiles.json'
  )
  return JSON.parse(readFileSync(p, 'utf-8'))[0] as EngineProfile
}

/** The profile's filing date — used as the evaluation date so derived
 *  fields (age via dateOfBirth) reproduce the profile's values exactly. */
export const AS_OF = '2025-01-05'

/** Engine sub-collection root → the request key it nests under on a member.
 *  These are full collection roots (not derived by splitting a path); the
 *  per-field mapping below goes through the field index. */
const SUB_COLLECTIONS: Array<[root: string, requestKey: string]> = [
  ['/incomes', 'income'],
  ['/expenses', 'expenses'],
  ['/jobs', 'jobs'],
  ['/resourceItems', 'assets'],
]

/**
 * Convert the engine profile into the friendly v2 request via the field
 * index. Every engine path is looked up in the index (never split); enum
 * values are converted to their snake_case wire form; the memberId
 * back-link (kind `implied`) is dropped in favor of nesting.
 */
export function buildFriendlyRequest(overrides?: { incomeAmount?: number }) {
  const model = getRuleset(SNAP_RULESET_ID)
  assert.ok(model, `ruleset ${SNAP_RULESET_ID} is loaded`)
  const profile = loadProfile()
  const byEnginePath = new Map<string, FieldEntry>(
    indexForModel(model!).map((e) => [e.enginePath, e])
  )

  const lookup = (enginePath: string): FieldEntry => {
    const entry = byEnginePath.get(enginePath)
    assert.ok(entry, `field index has an entry for ${enginePath}`)
    return entry!
  }

  const convert = (value: unknown, entry: FieldEntry): unknown =>
    entry.values && typeof value === 'string' ? snakeEnum(value) : value

  const household: Record<string, unknown> = {}
  for (const [enginePath, value] of Object.entries(profile.inputs)) {
    const entry = lookup(enginePath)
    household[entry.field] = convert(value, entry)
  }

  const members = profile.entities['/members'].map((row, i) => {
    // Every member must acknowledge every sub-collection: an explicit empty
    // array means "no rows", while omission would leave the collection
    // unprovided and the determination pending (v2-request.ts).
    const m: Record<string, unknown> = {
      id: `m${i}`,
      income: [],
      expenses: [],
      jobs: [],
      assets: [],
    }
    for (const [enginePath, value] of Object.entries(row)) {
      const entry = lookup(enginePath)
      if (entry.kind === 'derived' && entry.field === 'dateOfBirth') {
        // The engine's raw age maps to a dateOfBirth in the DTO. A mid-year
        // birthday keeps the age exact as of AS_OF (2025-01-05): born
        // `${2025 - age - 1}-07-01`, the birthday has not yet passed in
        // January, so the computed age is (2025 - (2025 - age - 1)) - 1 = age.
        m.dateOfBirth = `${2025 - (value as number) - 1}-07-01`
        continue
      }
      assert.notEqual(
        entry.kind,
        'derived',
        `unexpected derived member field ${enginePath} in the profile — extend the conversion`
      )
      m[entry.field] = convert(value, entry)
    }
    return m
  })

  for (const [root, requestKey] of SUB_COLLECTIONS) {
    const memberRefPath = `${root}/*/memberId`
    for (const row of profile.entities[root] ?? []) {
      const ref = row[memberRefPath]
      assert.match(String(ref), /^#\d+$/, `${memberRefPath} uses the positional form`)
      const memberIdx = Number(String(ref).slice(1))
      const obj: Record<string, unknown> = {}
      for (const [enginePath, value] of Object.entries(row)) {
        if (enginePath === memberRefPath) continue // implied by nesting
        const entry = lookup(enginePath)
        obj[entry.field] = convert(value, entry)
      }
      if (root === '/incomes' && overrides?.incomeAmount !== undefined) {
        obj.amount = overrides.incomeAmount
      }
      ;(members[memberIdx][requestKey] as unknown[]).push(obj)
    }
  }

  // The profile's caregiverRelationships collection is empty — acknowledge
  // it explicitly so the engine sees "no relationships", not "unknown".
  // (Reference fields in non-empty rows would carry the member's id string.)
  assert.equal(
    (profile.entities['/caregiverRelationships'] ?? []).length,
    0,
    'profile has no caregiver rows — extend the conversion if this changes'
  )

  return {
    asOf: AS_OF,
    household,
    members,
    caregiverRelationships: [],
  }
}
