/**
 * v2 SNAP money-path outcome tests — POST /v2/eligibility/snap/determination.
 *
 * Builds an approved golden fixture programmatically from the known-good
 * engine profile (data/factgraph/snap-complete/profiles.json) by converting
 * every engine-path input to the friendly v2 vocabulary through the field
 * index — the sanctioned path↔name boundary — then pins the approved and
 * denied determinations against hard-coded golden values, plus an income
 * boundary case at the gross income threshold.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import request from 'supertest'
import { getRuleset } from 'rules-visualizer-factgraph-core'

import { app } from './helpers.js'
import {
  indexForModel,
  snakeEnum,
  type FieldEntry,
} from '../src/translate/field-index.js'
import { SNAP_RULESET_ID } from '../src/translate/snap.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const V2_SNAP_URL = '/v2/eligibility/snap/determination'
const V1_QUERY_URL = `/v1/factgraph/${SNAP_RULESET_ID}/query`

// ---------------------------------------------------------------------------
// Golden values, discovered once by querying /v1/factgraph/snap-complete/query
// with the profile's raw engine inputs (targets /eligibilityCategory,
// /allotment, /isExpedited, /proratedAllotment) and hard-coded here:
//   /eligibilityCategory = "Ece"
//   /allotment           = 221
//   /proratedAllotment   = 192
//   /isExpedited         = false
// If a rules change moves these, the fixture's economics changed — re-derive
// deliberately rather than papering over the diff.
// ---------------------------------------------------------------------------
const GOLDEN_ALLOTMENT = 221
const GOLDEN_PRORATED_ALLOTMENT = 192

/** The single known-good profile shipped with the snap-complete ruleset:
 *  `inputs` are engine-path scalars, `entities` are collections keyed by
 *  root with engine-path row fields. */
type EngineProfile = {
  inputs: Record<string, unknown>
  entities: Record<string, Array<Record<string, unknown>>>
}

function loadProfile(): EngineProfile {
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
const AS_OF = '2025-01-05'

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
function buildFriendlyRequest(overrides?: { incomeAmount?: number }) {
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

// ---------------------------------------------------------------------------
// Approved golden
// ---------------------------------------------------------------------------

test('known-good profile converts to a fully-resolved approved determination', async () => {
  const res = await request(app).post(V2_SNAP_URL).send(buildFriendlyRequest())
  assert.equal(res.status, 200)
  assert.equal(res.body.asOf, AS_OF)

  const dets = res.body.determinations as Array<Record<string, unknown>>
  assert.equal(dets.length, 1)
  const det = dets[0]
  assert.equal(det.program, 'snap')
  assert.equal(det.scope, 'household')

  // A pending status or leftover missingInputs means the fixture conversion
  // dropped fields — surface them verbatim so the gap is diagnosable.
  assert.equal(
    det.missingInputs,
    undefined,
    `fixture must fully resolve; leftover missingInputs: ${JSON.stringify(det.missingInputs)}`
  )
  assert.equal(
    det.missingInputsByMember,
    undefined,
    `no per-member gaps expected: ${JSON.stringify(det.missingInputsByMember)}`
  )

  assert.equal(det.status, 'approved')
  assert.equal(det.benefitAmount, GOLDEN_ALLOTMENT)
  assert.equal(det.proratedFirstMonthAmount, GOLDEN_PRORATED_ALLOTMENT)
  assert.equal(typeof det.isExpedited, 'boolean')
})

// ---------------------------------------------------------------------------
// Denied golden
// ---------------------------------------------------------------------------

test('same fixture with income raised to 99999 is a denial with a coded reason and explanation', async () => {
  const res = await request(app)
    .post(V2_SNAP_URL)
    .send(buildFriendlyRequest({ incomeAmount: 99999 }))
  assert.equal(res.status, 200)

  const det = (res.body.determinations as Array<Record<string, unknown>>)[0]
  assert.ok(
    det.status === 'denied' || det.status === 'ineligible',
    `expected a denial, got ${JSON.stringify(det.status)}`
  )
  assert.match(
    String(det.denialReasonCode),
    /failed_(gross|net)_income_test|failed_resource_test/
  )

  const explanation = det.explanation as Array<{ factor: unknown; outcome: unknown }>
  assert.ok(
    Array.isArray(explanation) && explanation.length > 0,
    'denials carry a non-empty explanation'
  )
  for (const step of explanation) {
    assert.equal(typeof step.factor, 'string')
    assert.equal(step.outcome, false)
  }
})

// ---------------------------------------------------------------------------
// Income boundary — via the v1 query endpoint with raw engine inputs.
//
// Limits discovered once by querying /grossIncomeThreshold and
// /netIncomeThreshold with the eligible fixture's engine inputs (the profile
// resolves for a 1-person household as of 2025-01-05) and hard-coded here:
//   /grossIncomeThreshold = 1696.5
//   /netIncomeThreshold   = 1305
// (snap-complete names these *Threshold; /meetsGrossIncomeTest is
// grossIncome ≤ grossIncomeThreshold.)
// ---------------------------------------------------------------------------
const GOLDEN_GROSS_INCOME_THRESHOLD = 1696.5
const GOLDEN_NET_INCOME_THRESHOLD = 1305

/** The profile's raw engine inputs with the single income row's amount
 *  replaced. The row's monthly frequency makes /grossIncome equal the
 *  amount, so the boundary is set directly. */
function engineInputsWithIncome(amount: number): Record<string, unknown> {
  const profile = loadProfile()
  const entities = structuredClone(profile.entities)
  entities['/incomes'][0]['/incomes/*/amount'] = amount
  return { ...profile.inputs, ...entities }
}

test('gross income exactly at the limit passes the test; one dollar above fails it', async () => {
  const atLimit = await request(app)
    .post(V1_QUERY_URL)
    .send({
      targets: ['/grossIncome', '/grossIncomeThreshold', '/netIncomeThreshold', '/meetsGrossIncomeTest'],
      inputs: engineInputsWithIncome(GOLDEN_GROSS_INCOME_THRESHOLD),
    })
  assert.equal(atLimit.status, 200)
  assert.equal(
    atLimit.body.values['/grossIncomeThreshold'],
    GOLDEN_GROSS_INCOME_THRESHOLD,
    'pinned gross income threshold moved — re-derive the golden deliberately'
  )
  assert.equal(
    atLimit.body.values['/netIncomeThreshold'],
    GOLDEN_NET_INCOME_THRESHOLD,
    'pinned net income threshold moved — re-derive the golden deliberately'
  )
  assert.equal(atLimit.body.values['/grossIncome'], GOLDEN_GROSS_INCOME_THRESHOLD)
  assert.equal(atLimit.body.values['/meetsGrossIncomeTest'], true, 'at the limit: test holds')

  const overLimit = await request(app)
    .post(V1_QUERY_URL)
    .send({
      targets: ['/meetsGrossIncomeTest'],
      inputs: engineInputsWithIncome(GOLDEN_GROSS_INCOME_THRESHOLD + 1),
    })
  assert.equal(overLimit.status, 200)
  assert.equal(
    overLimit.body.values['/meetsGrossIncomeTest'],
    false,
    'one dollar above the limit: test fails'
  )
})
