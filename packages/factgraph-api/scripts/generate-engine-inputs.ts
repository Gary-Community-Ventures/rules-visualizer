/**
 * Generate docs/engine-inputs.json — the canonical, machine-readable catalog
 * of every input the eligibility API accepts, for a consumer building their
 * own data model against it. The rules engine is the source of truth; the
 * consumer conforms their shape to this.
 *
 * Built from the rulesets' writable facts via the adapter's field index
 * (src/translate/field-index.ts), so every field is presented as the consumer
 * sends it — a friendly `field` name in a `location` (`members[]`,
 * `members[].income[]`, `household`, …) — never as a Fact Graph path. The
 * canonical engine path rides along as `enginePath` for traceability. Field
 * names, types, enum vocabularies, and policy citations come straight from the
 * rules, so the catalog is a drift-free projection: add a writable input and
 * it shows up here on regeneration.
 *
 * `kind`: `applicant` (a value you provide) or `reference` (a link to another
 * row by its id, e.g. a spouse or caregiver). Member-owned sub-collections
 * nest under the member, so their member back-links are implied and omitted.
 *
 * This is the union of what each program *could* use, not a required set: the
 * engine determines on whatever subset is provided and reports what else would
 * unlock a determination (an empty request is valid). Each field is tagged with
 * the program(s) whose ruleset declares it; SNAP and Medicaid model some shared
 * concepts with different facts, so a concept can appear under each program.
 *
 * Regenerate: npm run gen:engine-inputs. The engine-inputs test fails on drift.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { loadFactGraphData, getRuleset } from 'rules-visualizer-factgraph-core'
import type { Model, ModelNode } from 'rules-visualizer-shared-types'

import { indexForModel, requestPath, type FieldEntry } from '../src/translate/field-index.js'

/**
 * Bump this when the field list changes (fields added, removed, renamed, or
 * enum values changed). Patch = additions; minor = removals/renames/type
 * changes; major = structural reshaping. Consumers embed this in their own
 * data model to detect when they need to re-sync.
 */
export const DICTIONARY_SCHEMA_VERSION = '1.0.0'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '..', '..', '..', 'data', 'factgraph')
const OUT = path.resolve(__dirname, '..', 'docs', 'engine-inputs.json')

const RULESETS: Array<{ id: string; program: string }> = [
  { id: 'snap-complete', program: 'SNAP' },
  { id: 'medicaid', program: 'Medicaid' },
]

/** Request location → display group, in presentation order. */
const GROUP_TITLE: Record<string, string> = {
  'members[]': 'Member',
  'members[].income[]': 'Income (nested under each member)',
  'members[].expenses[]': 'Expenses (nested under each member)',
  'members[].jobs[]': 'Jobs (nested under each member)',
  'members[].assets[]': 'Assets (nested under each member)',
  'caregiverRelationships[]': 'Caregiver relationships',
  household: 'Household & application',
}
const GROUP_ORDER = Object.keys(GROUP_TITLE)

function citations(node: ModelNode): Array<{ document: string; pages: number[] }> {
  const byDoc = new Map<string, Set<number>>()
  for (const r of node.references ?? []) {
    const set = byDoc.get(r.document.title) ?? new Set<number>()
    if (r.section.page) set.add(r.section.page)
    byDoc.set(r.document.title, set)
  }
  return [...byDoc.entries()].map(([document, pages]) => ({
    document,
    pages: [...pages].sort((a, b) => a - b),
  }))
}

export type EngineInputField = {
  /** The full dotted reference the consumer writes, e.g.
   *  `members[].citizenshipImmigrationStatus`. */
  requestPath: string
  /** The property key the consumer sends. */
  field: string
  /** Where it sits in the request body. */
  location: string
  /** The rule author's display name. */
  name: string
  kind: 'applicant' | 'reference' | 'derived'
  type: string
  programs: string[]
  /** For `derived` fields: how the engine computes its internal fact. */
  derivation?: string
  definition?: string
  /** snake_case enum values when the input is enum-typed. */
  values?: string[]
  citations: Array<{ document: string; pages: number[] }>
  /** Canonical Fact Graph path, for traceability — not part of the request. */
  enginePath: string
}

export type EngineInputGroup = { title: string; fields: EngineInputField[] }

export type EngineInputsDoc = {
  $comment: string
  schemaVersion: string
  about: string
  coverage: string
  kinds: Record<string, string>
  groups: EngineInputGroup[]
}

type Acc = { entry: FieldEntry; node: ModelNode; programs: Set<string> }

export function buildEngineInputs(): EngineInputsDoc {
  loadFactGraphData(DATA_DIR)

  // Merge fields across rulesets by their engine path; record declaring programs.
  const byPath = new Map<string, Acc>()
  for (const { id, program } of RULESETS) {
    const model = getRuleset(id) as Model | undefined
    if (!model) throw new Error(`ruleset "${id}" must be loadable`)
    const nodeByPath = new Map<string, ModelNode>()
    for (const node of Object.values(model.nodes) as ModelNode[]) {
      const c = node.content as { path?: string }
      if (c.path) nodeByPath.set(c.path, node)
    }
    for (const entry of indexForModel(model)) {
      // Implied member back-links aren't consumer fields.
      if (entry.kind === 'implied') continue
      const acc = byPath.get(entry.enginePath)
      if (acc) acc.programs.add(program)
      else
        byPath.set(entry.enginePath, {
          entry,
          node: nodeByPath.get(entry.enginePath)!,
          programs: new Set([program]),
        })
    }
  }

  const groups = new Map<string, EngineInputField[]>()
  for (const { entry, node, programs } of byPath.values()) {
    const field: EngineInputField = {
      requestPath: requestPath(entry),
      field: entry.field,
      location: entry.location,
      name: entry.name,
      kind: entry.kind as 'applicant' | 'reference' | 'derived',
      type: entry.type,
      programs: RULESETS.map((r) => r.program).filter((p) => programs.has(p)),
      derivation: entry.derivation,
      definition: node.description?.replace(/\s+/g, ' ').trim(),
      values: entry.values,
      citations: citations(node),
      enginePath: entry.enginePath,
    }
    const title = GROUP_TITLE[entry.location] ?? entry.location
    const list = groups.get(title) ?? []
    list.push(field)
    groups.set(title, list)
  }

  const outGroups: EngineInputGroup[] = GROUP_ORDER.map((loc) => GROUP_TITLE[loc])
    .filter((title) => groups.has(title))
    .map((title) => ({ title, fields: groups.get(title)! }))

  return {
    $comment:
      'GENERATED FILE — do not edit by hand. Source: scripts/generate-engine-inputs.ts (built from the rulesets via the adapter field index). Regenerate: npm run gen:engine-inputs.',
    schemaVersion: DICTIONARY_SCHEMA_VERSION,
    about:
      "Canonical catalog of every input the eligibility API accepts. The rules engine is the source of truth: build your data model to match these fields. Each field is shown as you send it — a friendly name in a request location — with the rule author’s name, definition, enum vocabulary, and policy citations taken directly from the rules. `enginePath` is the internal Fact Graph path it maps to, for traceability only. `schemaVersion` increments when the field list changes (additions: patch bump; removals/renames/type changes: minor bump) — compare it to detect whether to re-sync your data model.",
    coverage:
      'SNAP is a near-complete implementation of the program, so its inputs are exhaustive. Medicaid is a basic, illustrative subset — its input list is a sketch, not the full program. SNAP and Medicaid model some shared concepts (age, disability, income) with different facts, so a concept can appear under each program.',
    kinds: {
      applicant: 'A value you provide as-is.',
      derived:
        'You send an applicant-natural form (e.g. a date of birth) and the engine computes its internal fact; see the field’s derivation note.',
      reference:
        'A link to another row by its id (e.g. a member’s spouse, or a caregiver/dependent pairing).',
    },
    groups: outGroups,
  }
}

export function renderEngineInputs(): string {
  return JSON.stringify(buildEngineInputs(), null, 2) + '\n'
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  writeFileSync(OUT, renderEngineInputs())
  console.log(`Wrote ${OUT}`)
}
