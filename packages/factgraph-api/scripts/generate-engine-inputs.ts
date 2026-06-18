/**
 * Generate docs/engine-inputs.json — the canonical, machine-readable catalog
 * of every input the rules engine accepts, for a consumer building their own
 * data model against it. The rules engine is the source of truth; the consumer
 * conforms their shape to this.
 *
 * Built DIRECTLY FROM THE WRITABLE FACTS of each ruleset — not from the v1
 * ORCA field map. Every field is keyed by its real Fact Graph `path` and
 * labeled with the rule author's own `name` and `description` (no path
 * splitting, no invented domain vocabulary — see CLAUDE.md). Enum vocabularies
 * and policy citations come straight from the rules. This makes the catalog a
 * faithful, drift-free projection of the rules: add a writable input and it
 * shows up here on regeneration.
 *
 * `kind`:
 *   - applicant  a fact value the engine consumes (you provide it)
 *   - reference  an identity/link handle (a member cross-reference), not a value
 *
 * This is the union of what each program *could* use, not a required set. The
 * engine determines on whatever subset is provided and reports what else would
 * unlock a determination, so an empty request is valid (it comes back
 * undetermined with the needed inputs listed). Each field is tagged with the
 * program(s) whose ruleset declares it; SNAP and Medicaid model some shared
 * concepts with different facts, so a concept can appear under each program.
 *
 * Regenerate: npm run gen:engine-inputs. The engine-inputs test fails on drift.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { loadFactGraphData, getRuleset } from 'rules-visualizer-factgraph-core'
import type { Model, ModelNode } from 'rules-visualizer-shared-types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '..', '..', '..', 'data', 'factgraph')
const OUT = path.resolve(__dirname, '..', 'docs', 'engine-inputs.json')

const RULESETS: Array<{ id: string; program: string }> = [
  { id: 'snap-complete', program: 'SNAP' },
  { id: 'medicaid', program: 'Medicaid' },
]

/** Collection prefix → display group. Scalars (no collection) fall through to
 *  the household/application group. Order matters: most specific first. */
const GROUPS: Array<{ prefix: string; title: string }> = [
  { prefix: '/members/*/', title: 'Member' },
  { prefix: '/incomes/*/', title: 'Income (one row per source)' },
  { prefix: '/expenses/*/', title: 'Expense (one row per expense)' },
  { prefix: '/jobs/*/', title: 'Employment (one row per job)' },
  { prefix: '/resourceItems/*/', title: 'Resource / asset (one row per item)' },
  { prefix: '/caregiverRelationships/*/', title: 'Caregiver relationship (one row per pair)' },
]
const SCALAR_GROUP = 'Household & application'

function groupFor(p: string): string {
  return GROUPS.find((g) => p.startsWith(g.prefix))?.title ?? SCALAR_GROUP
}

/** PascalCase / mixed rules enum option → snake_case wire value. */
function snake(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z])([0-9])/g, '$1_$2')
    .toLowerCase()
}

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
  /** The canonical Fact Graph path — the field's identity on the wire. */
  path: string
  /** The rule author's display name for the fact. */
  name: string
  kind: 'applicant' | 'reference'
  type: string
  programs: string[]
  definition?: string
  /** snake_case enum values when the input is enum-typed. */
  values?: string[]
  citations: Array<{ document: string; pages: number[] }>
}

export type EngineInputGroup = { title: string; fields: EngineInputField[] }

export type EngineInputsDoc = {
  $comment: string
  about: string
  coverage: string
  kinds: Record<string, string>
  groups: EngineInputGroup[]
}

type Acc = { node: ModelNode; programs: Set<string> }

export function buildEngineInputs(): EngineInputsDoc {
  loadFactGraphData(DATA_DIR)

  // Merge writables across rulesets by path; record which programs declare each.
  const byPath = new Map<string, Acc>()
  for (const { id, program } of RULESETS) {
    const model = getRuleset(id) as Model | undefined
    if (!model) throw new Error(`ruleset "${id}" must be loadable`)
    for (const node of Object.values(model.nodes) as ModelNode[]) {
      const c = node.content as {
        type: string
        path?: string
        typeName?: string
      }
      if (c.type !== 'writable' || !c.path || c.typeName === 'Collection') continue
      const acc = byPath.get(c.path)
      if (acc) acc.programs.add(program)
      else byPath.set(c.path, { node, programs: new Set([program]) })
    }
  }

  // Bucket into display groups, preserving first-seen order within each.
  const groups = new Map<string, EngineInputField[]>()
  for (const [p, { node, programs }] of byPath) {
    const c = node.content as {
      typeName?: string
      enumOptions?: string[]
      label?: string
    }
    const field: EngineInputField = {
      path: p,
      // The rule author's display name (the XML <Name>) lives on content.label;
      // node.name is the path-based id. Never reconstruct a name from the path.
      name: c.label ?? node.name,
      kind: c.typeName === 'CollectionItem' ? 'reference' : 'applicant',
      type: c.typeName ?? 'Unknown',
      programs: RULESETS.map((r) => r.program).filter((pr) => programs.has(pr)),
      definition: node.description?.replace(/\s+/g, ' ').trim(),
      values: c.enumOptions?.map(snake),
      citations: citations(node),
    }
    const title = groupFor(p)
    const list = groups.get(title) ?? []
    list.push(field)
    groups.set(title, list)
  }

  // Stable group order: collections in GROUPS order, then scalars last.
  const order = [...GROUPS.map((g) => g.title), SCALAR_GROUP]
  const outGroups: EngineInputGroup[] = order
    .filter((t) => groups.has(t))
    .map((title) => ({ title, fields: groups.get(title)! }))

  return {
    $comment:
      'GENERATED FILE — do not edit by hand. Source: scripts/generate-engine-inputs.ts (built from the rulesets’ writable facts). Regenerate: npm run gen:engine-inputs.',
    about:
      'Canonical catalog of every input the rules engine accepts. The rules engine is the source of truth: build your data model to match these fields. Each field is keyed by its Fact Graph path (its identity on the wire) and labeled with the rule author’s name, definition, enum vocabulary, and policy citations, taken directly from the rules.',
    coverage:
      'SNAP is a near-complete implementation of the program, so its inputs are exhaustive. Medicaid is a basic, illustrative subset — its input list is a sketch, not the full program. SNAP and Medicaid model some shared concepts (age, disability, income) with different facts, so a concept can appear under each program.',
    kinds: {
      applicant: 'A fact value the engine consumes; you provide it.',
      reference:
        'An identity/link handle (a member cross-reference such as a spouse or caregiver), not a fact value.',
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
