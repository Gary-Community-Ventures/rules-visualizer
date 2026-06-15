/**
 * Generate example request bodies for the generic query API
 * (POST /v1/factgraph/snap-complete/query) into docs/examples/.
 *
 * Three blobs, all generated from the live graph (never hand-maintained):
 *  - all-inputs : every writable populated (realistic where it matters,
 *                 typed defaults elsewhere)
 *  - minimal    : greedily reduced to only the inputs that affect this
 *                 determination — the same outcome with the fewest fields
 *  - multi-member: a 3-person household exercising real cross-references
 *                 (spouse, caregiver→dependent, per-member income)
 *
 * Regenerate: npm run gen:examples. The query-examples test re-runs each
 * committed blob through the engine and fails if any stops resolving, so a
 * rule change that breaks an example is caught in CI.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { loadFactGraphData, getRuleset, getRawFacts } from 'rules-visualizer-factgraph-core'
import type { Model, ModelNode } from 'rules-visualizer-shared-types'

import { runQuery } from '../src/evaluate.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '..', '..', '..', 'data', 'factgraph')
const OUT_DIR = path.resolve(__dirname, '..', 'docs', 'examples')
const RULESET = 'snap-complete'

export const EXAMPLE_TARGETS = [
  '/eligibilityCategory',
  '/allotment',
  '/proratedAllotment',
  '/isExpedited',
]

export type QueryBlob = {
  targets: string[]
  inputs: Record<string, unknown>
}

// Realistic per-path values so the examples read like a real applicant; every
// other writable gets a typed default from its graph node.
const REAL: Record<string, unknown> = {
  '/applicationFilingDate': '2026-06-15',
  '/benefitMonth': '2026-06-01',
  '/certificationPeriodStartDate': '2026-06-01',
  '/normalIssuanceCycleDate': '2026-06-15',
  '/livesInApplicationCounty': true,
  '/hasOrExpectsShelterCosts': true,
  '/members/*/age': 35,
  '/members/*/isHeadOfHousehold': true,
  '/members/*/citizenshipImmigrationStatus': 'Citizen',
  '/members/*/preparesFoodWithHousehold': true,
  '/members/*/registeredForWork': true,
  '/members/*/providedEmploymentStatusOrAvailabilityInfo': true,
  '/members/*/reportedToReferredSuitableEmployer': true,
  '/members/*/studentEnrollmentStatus': 'LessThanHalfTimeOrNotEnrolled',
  '/incomes/*/type': 'WagesAndSalaries',
  '/incomes/*/amount': 1200,
  '/incomes/*/frequency': 'Monthly',
  '/jobs/*/hoursPerWeek': 30,
  '/jobs/*/abawdWorkType': 'CompensatedWork',
  '/jobs/*/offerAccepted': true,
  '/expenses/*/type': 'Rent',
  '/expenses/*/amount': 800,
  '/expenses/*/frequency': 'Monthly',
  '/expenses/*/isForClaimableShelterResidence': true,
  '/resourceItems/*/type': 'CheckingAccount',
  '/resourceItems/*/value': 500,
}

const COLL_ROOT: Record<string, string> = {
  '/members/*': '/members',
  '/incomes/*': '/incomes',
  '/expenses/*': '/expenses',
  '/jobs/*': '/jobs',
  '/resourceItems/*': '/resourceItems',
  '/caregiverRelationships/*': '/caregiverRelationships',
}

type Writable = { path: string; typeName?: string; enumOptions?: string[] }

function writables(model: Model): Writable[] {
  const out: Writable[] = []
  for (const node of Object.values(model.nodes) as ModelNode[]) {
    const c = node.content as {
      type: string
      path?: string
      typeName?: string
      enumOptions?: string[]
    }
    if (c.type !== 'writable' || !c.path || c.typeName === 'Collection') continue
    out.push({ path: c.path, typeName: c.typeName, enumOptions: c.enumOptions })
  }
  return out
}

function typedValue(w: Writable): unknown {
  if (w.path in REAL) return REAL[w.path]
  switch (w.typeName) {
    case 'Boolean': return false
    case 'Int': case 'Short': case 'Byte': case 'Dollar': case 'Rational': return 0
    case 'Day': return '2026-06-15'
    case 'Enum': return w.enumOptions?.[0] ?? ''
    case 'CollectionItem': return '#0'
    case 'String': return ''
    default: return false
  }
}

/** Every writable populated; one row per collection. */
function buildAllInputs(model: Model): Record<string, unknown> {
  const inputs: Record<string, unknown> = {}
  const rows: Record<string, Record<string, unknown>> = {}
  for (const w of writables(model)) {
    const m = w.path.match(/^(\/[^/]+\/\*)\//)
    if (m) {
      const root = COLL_ROOT[m[1]]
      const row = (rows[root] ??= {
        id: root === '/members' ? 'head' : root.slice(1) + '-1',
      })
      row[w.path] = typedValue(w)
    } else {
      inputs[w.path] = typedValue(w)
    }
  }
  for (const [root, row] of Object.entries(rows)) inputs[root] = [row]
  return inputs
}

function outcome(model: Model, facts: ReturnType<typeof getRawFacts>, inputs: Record<string, unknown>) {
  const r = runQuery(RULESET, model, facts!, { targets: EXAMPLE_TARGETS, inputs })
  if (!r.ok) throw new Error('unknown targets')
  return { status: r.response.status, values: JSON.stringify(r.response.values) }
}

/** Greedily drop any field that doesn't change the determination, leaving the
 *  smallest input set that yields the same complete result. */
function minimize(
  model: Model,
  facts: ReturnType<typeof getRawFacts>,
  full: Record<string, unknown>
): Record<string, unknown> {
  const base = outcome(model, facts, full)
  const work: Record<string, unknown> = JSON.parse(JSON.stringify(full))
  const stillSame = () => {
    const o = outcome(model, facts, work)
    return o.status === 'complete' && o.values === base.values
  }
  // Scalars first.
  for (const key of Object.keys(work)) {
    if (Array.isArray(work[key])) continue
    const saved = work[key]
    delete work[key]
    if (!stillSame()) work[key] = saved
  }
  // Then per-row fields (keep id + any memberId cross-reference).
  for (const key of Object.keys(work)) {
    const rows = work[key]
    if (!Array.isArray(rows)) continue
    for (const row of rows as Array<Record<string, unknown>>) {
      for (const f of Object.keys(row)) {
        if (f === 'id' || f.endsWith('/memberId')) continue
        const saved = row[f]
        delete row[f]
        if (!stillSame()) row[f] = saved
      }
    }
  }
  return work
}

/** A 3-person household with real cross-references. */
function buildMultiMember(model: Model): Record<string, unknown> {
  const all = buildAllInputs(model)
  const memberTemplate = (all['/members'] as Array<Record<string, unknown>>)[0]
  const mk = (over: Record<string, unknown>) => ({ ...memberTemplate, ...over })

  const head = mk({ id: 'head', '/members/*/isHeadOfHousehold': true, '/members/*/age': 40, '/members/*/spouseId': '#1' })
  const spouse = mk({ id: 'spouse', '/members/*/isHeadOfHousehold': false, '/members/*/age': 38, '/members/*/spouseId': '#0' })
  const child = mk({ id: 'child', '/members/*/isHeadOfHousehold': false, '/members/*/age': 8, '/members/*/isInK12': true })

  const incomeRow = (all['/incomes'] as Array<Record<string, unknown>>)[0]
  const jobRow = (all['/jobs'] as Array<Record<string, unknown>>)[0]
  const expenseRow = (all['/expenses'] as Array<Record<string, unknown>>)[0]
  const resourceRow = (all['/resourceItems'] as Array<Record<string, unknown>>)[0]
  const caregiverRow = (all['/caregiverRelationships'] as Array<Record<string, unknown>>)[0]

  return {
    ...Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith('/'))),
    // scalars
    ...Object.fromEntries(
      Object.entries(all).filter(([, v]) => !Array.isArray(v))
    ),
    '/members': [head, spouse, child],
    '/incomes': [
      { ...incomeRow, id: 'head-wages', '/incomes/*/memberId': '#0', '/incomes/*/amount': 1500 },
      { ...incomeRow, id: 'spouse-wages', '/incomes/*/memberId': '#1', '/incomes/*/amount': 900 },
    ],
    '/jobs': [
      { ...jobRow, id: 'head-job', '/jobs/*/memberId': '#0' },
      { ...jobRow, id: 'spouse-job', '/jobs/*/memberId': '#1', '/jobs/*/hoursPerWeek': 20 },
    ],
    '/expenses': [{ ...expenseRow, '/expenses/*/memberId': '#0' }],
    '/resourceItems': [{ ...resourceRow, '/resourceItems/*/memberId': '#0' }],
    // head is the caregiver who provides most of the care for the child (#2)
    '/caregiverRelationships': [
      {
        ...caregiverRow,
        '/caregiverRelationships/*/caregiverId': '#0',
        '/caregiverRelationships/*/dependentId': '#2',
        '/caregiverRelationships/*/isParent': true,
        '/caregiverRelationships/*/caregiverProvidesMoreThanHalfOfPhysicalCare': true,
      },
    ],
  }
}

const FILES: Array<{ name: string; build: (m: Model, f: ReturnType<typeof getRawFacts>) => Record<string, unknown> }> = [
  { name: 'snap-complete-all-inputs.query.json', build: (m) => buildAllInputs(m) },
  { name: 'snap-complete-minimal.query.json', build: (m, f) => minimize(m, f, buildAllInputs(m)) },
  { name: 'snap-complete-multi-member.query.json', build: (m) => buildMultiMember(m) },
]

export function renderExample(name: string): string {
  loadFactGraphData(DATA_DIR)
  const model = getRuleset(RULESET)
  const facts = getRawFacts(RULESET)
  if (!model || !facts) throw new Error('snap-complete must be loadable')
  const spec = FILES.find((f) => f.name === name)
  if (!spec) throw new Error(`unknown example ${name}`)
  const blob: QueryBlob = { targets: EXAMPLE_TARGETS, inputs: spec.build(model, facts) }
  return JSON.stringify(blob, null, 2) + '\n'
}

export const EXAMPLE_NAMES = FILES.map((f) => f.name)

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  for (const name of EXAMPLE_NAMES) {
    writeFileSync(path.join(OUT_DIR, name), renderExample(name))
    console.log(`Wrote ${path.join(OUT_DIR, name)}`)
  }
}
