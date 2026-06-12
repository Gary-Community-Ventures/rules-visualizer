/**
 * Generate docs/input-dictionary.md — the authoritative definition of every
 * v2 request field — by joining src/v2-field-map.ts with the rulesets
 * themselves: each mapped graph input contributes its rule-author-written
 * description, its data type, its enum vocabulary, and its policy citations
 * (from references.json, already resolved onto the model by the parser).
 *
 * Definitions are AUTHORED ONCE, in the rules, and flow here — this file is
 * never edited by hand. Regenerate: npm run gen:dictionary. The
 * input-dictionary test fails if the committed file drifts, and also fails
 * if a ruleset gains a writable input the field map doesn't cover.
 *
 * `buildDictionaryData()` exposes the joined data so other renderers (the
 * docs site's filterable HTML page) stay in lockstep with the markdown.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { loadFactGraphData, getRuleset } from 'rules-visualizer-factgraph-core'
import type { Model, ModelNode } from 'rules-visualizer-shared-types'

import {
  FIELD_MAP,
  VOCABULARIES,
  PUBLISHED_CONTRACT_FIELDS,
  sourceOf,
} from '../src/v2-field-map.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '..', '..', '..', 'data', 'factgraph')
const OUT = path.resolve(__dirname, '..', 'docs', 'input-dictionary.md')

type NodeInfo = {
  description?: string
  label?: string
  typeName?: string
  enumOptions?: string[]
  citations: Array<{ title: string; pages: number[] }>
}

function buildLookup(model: Model): Map<string, NodeInfo> {
  const out = new Map<string, NodeInfo>()
  for (const node of Object.values(model.nodes) as ModelNode[]) {
    const c = node.content
    if (c.type === 'entity' || !('path' in c)) continue
    const byTitle = new Map<string, Set<number>>()
    for (const r of node.references ?? []) {
      const set = byTitle.get(r.document.title) ?? new Set<number>()
      if (r.section.page) set.add(r.section.page)
      byTitle.set(r.document.title, set)
    }
    out.set(c.path, {
      description: node.description,
      label: 'label' in c ? c.label : undefined,
      typeName: 'typeName' in c ? (c as { typeName?: string }).typeName : undefined,
      enumOptions: 'enumOptions' in c ? (c as { enumOptions?: string[] }).enumOptions : undefined,
      citations: [...byTitle.entries()].map(([title, pages]) => ({
        title,
        pages: [...pages].sort((a, b) => a - b),
      })),
    })
  }
  return out
}

export function toSnakeCase(v: string): string {
  return v
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z])([0-9])/g, '$1_$2')
    .toLowerCase()
}

function firstPath(p?: string | string[]): string | undefined {
  return Array.isArray(p) ? p[0] : p
}

function allPaths(p?: string | string[]): string[] {
  return p === undefined ? [] : Array.isArray(p) ? p : [p]
}

/** All graph paths an entry touches, for the completeness check. */
export function mappedPaths(): { snap: Set<string>; medicaid: Set<string> } {
  const snap = new Set<string>()
  const medicaid = new Set<string>()
  for (const group of FIELD_MAP) {
    for (const e of group.entries) {
      for (const p of allPaths(e.snap)) snap.add(p)
      for (const p of allPaths(e.medicaid)) medicaid.add(p)
    }
  }
  return { snap, medicaid }
}

/** Writable inputs the map intentionally does not carry as API fields:
 *  collection-row member references are expressed by nesting rows under the
 *  member in the v2 request, so they have no field of their own. */
export const STRUCTURAL_UNMAPPED = new Set([
  '/incomes/*/memberId',
  '/expenses/*/memberId',
  '/resourceItems/*/memberId',
  '/jobs/*/memberId',
])

// ---------------------------------------------------------------------------
// Shared data model (consumed by the markdown renderer and the docs site)
// ---------------------------------------------------------------------------

export type DictionaryEntry = {
  field: string
  type: string
  /** snake_case enum values when the input is enum-typed. */
  values?: string[]
  programs: string[]
  kind: string
  source?: string
  definition?: string
  /** Adapter mapping note (how derived values are computed, caveats). */
  note?: string
  citations: Array<{ title: string; pages: number[] }>
  inPublishedContract: boolean
}

export type DictionaryGroup = { title: string; entries: DictionaryEntry[] }

export type DictionaryVocabulary = {
  title: string
  apiField: string
  description?: string
  values: string[]
}

export type DictionaryData = {
  groups: DictionaryGroup[]
  vocabularies: DictionaryVocabulary[]
  totals: { applicant: number; state: number; either: number }
}

export function buildDictionaryData(): DictionaryData {
  loadFactGraphData(DATA_DIR)
  const snapModel = getRuleset('snap-complete')
  const medicaidModel = getRuleset('medicaid')
  if (!snapModel || !medicaidModel) {
    throw new Error('snap-complete and medicaid rulesets must be loadable')
  }
  const snap = buildLookup(snapModel)
  const medicaid = buildLookup(medicaidModel)

  const totals = { applicant: 0, state: 0, either: 0 }
  const groups: DictionaryGroup[] = FIELD_MAP.map((group) => ({
    title: group.title,
    entries: group.entries.map((e) => {
      const info =
        (firstPath(e.snap) ? snap.get(firstPath(e.snap)!) : undefined) ??
        (firstPath(e.medicaid) ? medicaid.get(firstPath(e.medicaid)!) : undefined)
      const source =
        e.kind === 'structural' ? undefined : sourceOf(group.title, e.field)
      if (source && e.kind !== 'compat') totals[source as keyof typeof totals]++
      return {
        field: e.field,
        type:
          e.kind === 'structural'
            ? 'reference'
            : e.kind === 'compat'
              ? '—'
              : (info?.typeName ?? '—'),
        values: info?.enumOptions?.map(toSnakeCase),
        programs: [e.snap && 'SNAP', e.medicaid && 'Medicaid'].filter(
          Boolean
        ) as string[],
        kind: e.kind,
        source,
        definition: info?.description ?? info?.label,
        note: e.note,
        citations: info?.citations ?? [],
        inPublishedContract: PUBLISHED_CONTRACT_FIELDS.has(e.field),
      }
    }),
  }))

  const vocabularies: DictionaryVocabulary[] = VOCABULARIES.map((v) => {
    const model = v.ruleset === 'medicaid' ? medicaid : snap
    const info = model.get(v.path)
    return {
      title: v.title,
      apiField: v.apiField,
      description: info?.description,
      values: (info?.enumOptions ?? []).map(toSnakeCase),
    }
  })

  return { groups, vocabularies, totals }
}

// ---------------------------------------------------------------------------
// Markdown renderer — one vertical entry per field (no wide tables; GitHub's
// renderer forces horizontal scrolling on prose-bearing tables). Each field
// is an h4, so it has a stable anchor for deep-linking in reviews.
// ---------------------------------------------------------------------------

function fmtCitations(citations: DictionaryEntry['citations']): string {
  return citations
    .map((c) =>
      c.pages.length > 0
        ? `${c.title} — ${c.pages.length > 1 ? 'pp.' : 'p.'} ${c.pages.join(', ')}`
        : c.title
    )
    .join('; ')
}

export function renderInputDictionary(): string {
  const data = buildDictionaryData()
  const lines: string[] = []
  const w = (s = '') => lines.push(s)

  w('# Input dictionary — v2 eligibility adapter request')
  w()
  w('<!-- GENERATED FILE — do not edit by hand. -->')
  w('<!-- Source: scripts/generate-input-dictionary.ts joining src/v2-field-map.ts with the rulesets. -->')
  w('<!-- Regenerate: npm run gen:dictionary --workspace=rules-visualizer-factgraph-api -->')
  w()
  w('Authoritative definitions for every field in the [v2 draft contract](./eligibility-adapter-v2-proposal-openapi.yaml).')
  w('Definitions, data types, enum vocabularies, and policy citations are pulled')
  w('directly from the rulesets — the same text the rule authors wrote against')
  w('the regulations — so this document cannot drift from what the rules')
  w('actually mean. A filterable version lives on the')
  w('[docs site](https://gary-community-ventures.github.io/rules-visualizer/dictionary.html).')
  w()
  w('**Design principle: inputs are observable facts, not program conclusions.**')
  w('A fact like "receives SSI" means the same thing to every program; each')
  w("program's rules derive its own concepts (e.g. its legal definition of")
  w('"disabled" or its household unit) from these facts. Where the inherited')
  w('contract carries a conclusion-shaped field (`isDisabled`,')
  w('`household.size`), the dictionary notes the precise facts to prefer.')
  w()
  w('Each entry reads: **type · programs that consume it · kind · source.**')
  w('**Kind** is how the adapter maps it — `direct` (passes through), `derived`')
  w('(computed; the note says how), `structural` (identity/reference plumbing),')
  w('`compat` (carried for contract compatibility; not consumed by the rules).')
  w('**Source** is our best guess at where the value realistically originates —')
  w('`applicant` (self-attestable on an application form), `state` (records')
  w('checks, case history, batch/data-exchange systems), or `either`. These')
  w('guesses are offered for the Worker Portal team and the State to correct;')
  w('they drive the candidate-additions list below. Fields that already exist')
  w("in the partner's published worker-portal contract (the eligibility-")
  w('adapter OpenAPI in safety-net-blueprint) are marked ✦ — the candidate-')
  w('additions list below is exactly the applicant-attestable fields WITHOUT')
  w('that marker.')
  w()
  w("Which fields are *required*? Per case, not per program: the rules")
  w("short-circuit, so the authoritative answer is the response's")
  w('`missingInformation` (send what you have; it lists exactly what is still')
  w('needed). See "Getting started" at the bottom for practical starting sets.')
  w()

  for (const group of data.groups) {
    w(`## ${group.title}`)
    w()
    for (const e of group.entries) {
      w(`#### \`${e.field}\``)
      w()
      const meta: string[] = [`\`${e.type}\``]
      meta.push(e.programs.length ? e.programs.join(' + ') : 'no program (see note)')
      meta.push(e.kind)
      if (e.source) meta.push(`source: **${e.source}**`)
      if (e.inPublishedContract) meta.push('✦ in the published worker-portal contract')
      w(meta.join(' · '))
      w()
      if (e.definition) {
        w(e.definition.replace(/\n+/g, ' ').trim())
        w()
      }
      if (e.note) {
        w(`> *Adapter mapping:* ${e.note.replace(/\n+/g, ' ').trim()}`)
        w()
      }
      if (e.values) {
        if (e.values.length <= 20) {
          w(`Allowed values: ${e.values.map((v) => '`' + v + '`').join(' · ')}`)
        } else {
          w(`Allowed values: ${e.values.length} — see [Vocabularies](#vocabularies).`)
        }
        w()
      }
      if (e.citations.length > 0) {
        w(`Policy: ${fmtCitations(e.citations)}`)
        w()
      }
    }
  }

  w('## Candidate worker-portal contract additions')
  w()
  w('Fields that pass the realistic-source test for the portal — `applicant`')
  w('or `either` origin — and are **not** in the published worker-portal')
  w('contract today. Generated from the Source classification above; offered')
  w('as the starting list for the contract conversation (which of these the')
  w('portal application should actually ask is a Worker Portal / State')
  w('workflow decision). Fields classified `state` belong at the')
  w('rules-engine boundary (the v2 contract), supplied by the systems that')
  w('hold case records and data-exchange results — not by the portal.')
  w()
  for (const group of data.groups) {
    const candidates = group.entries.filter(
      (e) =>
        e.kind !== 'structural' &&
        e.kind !== 'compat' &&
        !e.inPublishedContract &&
        (e.source === 'applicant' || e.source === 'either')
    )
    if (candidates.length === 0) continue
    w(`- **${group.title}**: ${candidates.map((e) => '`' + e.field + '`').join(', ')}`)
  }
  w()
  w(
    `Totals across mapped value fields: ${data.totals.applicant} applicant-attestable, ${data.totals.either} either, ${data.totals.state} state-systems-only.`
  )
  w()

  w('## Vocabularies')
  w()
  w('Full value sets for the open-string `detailType`-style fields. Values are')
  w('the snake_case form the API accepts; each maps 1:1 onto the rules')
  w('vocabulary.')
  w()
  for (const v of data.vocabularies) {
    w(`### ${v.title} (\`${v.apiField}\`)`)
    w()
    if (v.description) w(v.description)
    w()
    w(v.values.map((o) => '`' + o + '`').join(' · '))
    w()
  }

  w('## Getting started — what to send')
  w()
  w('The only schema-required fields are `program`, `household`, and per')
  w('member `id` + `dateOfBirth`. Practical starting sets:')
  w()
  w('- **Medicaid**: demographics (`dateOfBirth`, citizenship/immigration),')
  w('  `income[]`, and where applicable `pregnancy`, `disabilityDetails`,')
  w('  `studentStatus.enrollment`, `employment[].hoursPerWeek`. The graph')
  w('  needs only ~13 facts.')
  w('- **SNAP**: the medicaid set plus `expenses[]`, `assets[]`,')
  w('  `employment[]` detail, `livingSituation`, `workRequirements`, and —')
  w('  for a final (non-`pending`) determination — the `findings` block once')
  w('  verification completes.')
  w()
  w('From there, drive intake off the response: every `pending` decision')
  w('returns `missingInformation` listing exactly which of these fields are')
  w('still needed *for this case* — correct even when the rules short-circuit')
  w('(e.g. categorically-eligible SNAP households are never asked for assets).')
  w()

  return lines.join('\n')
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  writeFileSync(OUT, renderInputDictionary())
  console.log(`Wrote ${OUT}`)
}
