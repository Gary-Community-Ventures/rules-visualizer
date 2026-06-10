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
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { loadFactGraphData, getRuleset } from 'rules-visualizer-factgraph-core'
import type { Model, ModelNode } from 'rules-visualizer-shared-types'

import { FIELD_MAP, VOCABULARIES, type FieldMapping } from '../src/v2-field-map.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '..', '..', '..', 'data', 'factgraph')
const OUT = path.resolve(__dirname, '..', 'docs', 'input-dictionary.md')

type NodeInfo = {
  description?: string
  label?: string
  typeName?: string
  enumOptions?: string[]
  citations: string[]
}

function buildLookup(model: Model): Map<string, NodeInfo> {
  const out = new Map<string, NodeInfo>()
  for (const node of Object.values(model.nodes) as ModelNode[]) {
    const c = node.content
    if (c.type === 'entity' || !('path' in c)) continue
    const citations = (node.references ?? []).map((r) => {
      const page = r.section.page ? ` p.${r.section.page}` : ''
      return `${r.document.title}${page}`
    })
    out.set(c.path, {
      description: node.description,
      label: 'label' in c ? c.label : undefined,
      typeName: 'typeName' in c ? (c as { typeName?: string }).typeName : undefined,
      enumOptions: 'enumOptions' in c ? (c as { enumOptions?: string[] }).enumOptions : undefined,
      citations: [...new Set(citations)],
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

function cell(s: string): string {
  return s.replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim()
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

export function renderInputDictionary(): string {
  loadFactGraphData(DATA_DIR)
  const snapModel = getRuleset('snap-complete')
  const medicaidModel = getRuleset('medicaid')
  if (!snapModel || !medicaidModel) {
    throw new Error('snap-complete and medicaid rulesets must be loadable')
  }
  const snap = buildLookup(snapModel)
  const medicaid = buildLookup(medicaidModel)

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
  w('actually mean.')
  w()
  w('**Design principle: inputs are observable facts, not program conclusions.**')
  w('A fact like "receives SSI" means the same thing to every program; each')
  w('program\'s rules derive its own concepts (e.g. its legal definition of')
  w('"disabled" or its household unit) from these facts. Where the inherited')
  w('contract carries a conclusion-shaped field (`isDisabled`,')
  w('`household.size`), the dictionary notes the precise facts to prefer.')
  w()
  w('**Programs** column: which program rules consume the field today.')
  w('**Kind**: how the adapter maps it — `direct` (passes through), `derived`')
  w('(computed; the note says how), `structural` (identity/reference plumbing),')
  w('`compat` (carried for contract compatibility; not consumed by the rules).')
  w()
  w('Which fields are *required*? Per case, not per program: the rules')
  w('short-circuit, so the authoritative answer is the response\'s')
  w('`missingInformation` (send what you have; it lists exactly what is still')
  w('needed). See "Getting started" at the bottom for practical starting sets.')
  w()

  for (const group of FIELD_MAP) {
    w(`## ${group.title}`)
    w()
    w('| Field | Type | Programs | Kind | Definition (from the rules) | Policy citation |')
    w('|---|---|---|---|---|---|')
    for (const e of group.entries) {
      const sPath = firstPath(e.snap)
      const mPath = firstPath(e.medicaid)
      const sInfo = sPath ? snap.get(sPath) : undefined
      const mInfo = mPath ? medicaid.get(mPath) : undefined
      const info = sInfo ?? mInfo

      const programs =
        [e.snap && 'SNAP', e.medicaid && 'Medicaid'].filter(Boolean).join(', ') ||
        '—'
      const typeName =
        e.kind === 'compat' || e.kind === 'structural'
          ? e.kind === 'structural'
            ? 'reference'
            : '—'
          : (info?.typeName ?? '—')
      const enumSuffix =
        info?.enumOptions && info.enumOptions.length <= 20
          ? `<br>Values: ${info.enumOptions.map((v) => '`' + toSnakeCase(v) + '`').join(', ')}`
          : info?.enumOptions
            ? `<br>${info.enumOptions.length} values — see Vocabularies below`
            : ''
      const definitionParts: string[] = []
      if (info?.description) definitionParts.push(info.description)
      else if (info?.label) definitionParts.push(info.label)
      if (e.note) definitionParts.push(`*${e.note}*`)
      const definition = definitionParts.join(' ') || '—'
      const citation = info?.citations.length ? info.citations.join('; ') : '—'

      w(
        `| \`${e.field}\` | ${cell(typeName)}${enumSuffix} | ${programs} | ${e.kind} | ${cell(definition)} | ${cell(citation)} |`
      )
    }
    w()
  }

  w('## Vocabularies')
  w()
  w('Full value sets for the open-string `detailType`-style fields. Values are')
  w('the snake_case form the API accepts; each maps 1:1 onto the rules')
  w('vocabulary.')
  w()
  for (const v of VOCABULARIES) {
    const model = v.ruleset === 'medicaid' ? medicaid : snap
    const info = model.get(v.path)
    const options = info?.enumOptions ?? []
    w(`### ${v.title} (\`${v.apiField}\`)`)
    w()
    if (info?.description) w(info.description)
    w()
    w(options.map((o) => '`' + toSnakeCase(o) + '`').join(' · '))
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
