/**
 * Generate docs/engine-inputs.json — the canonical, machine-readable catalog
 * of every input the rules engine accepts, for a consumer building their own
 * data model against it (the rules engine is the source of truth; the consumer
 * conforms their shape to this, not the reverse).
 *
 * Generated from the rulesets themselves (definitions, data types, enum
 * vocabularies, and policy citations are the rule authors' own words, resolved
 * onto the model by the parser) joined with src/v2-field-map.ts for the field
 * grouping and the applicant→engine derivations. Never edited by hand;
 * regenerate with `npm run gen:engine-inputs`. The engine-inputs test fails if
 * the committed file drifts.
 *
 * `kind` describes the caller's relationship to each field:
 *   - applicant  a value the caller provides, used as-is (modulo enum casing)
 *   - derived    a value the caller provides in an applicant-natural form
 *                (e.g. dateOfBirth) that the engine derives into its internal
 *                fact (e.g. age); the `derivation` note says how
 *   - reference  an identity/linking handle (member ids and cross-references),
 *                not a fact value
 *
 * This is the union of what each program *could* use, not a required set. The
 * engine determines on whatever subset is provided and reports what else would
 * unlock a determination, so an empty request is valid (it comes back
 * undetermined with the needed inputs listed).
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { buildDictionaryData } from './generate-input-dictionary.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(__dirname, '..', 'docs', 'engine-inputs.json')

/** FIELD_MAP `kind` → the caller-facing kind. `compat` (carried only for the
 *  old conformance shape, not consumed by the rules) is dropped entirely. */
const KIND: Record<string, 'applicant' | 'derived' | 'reference' | null> = {
  direct: 'applicant',
  derived: 'derived',
  structural: 'reference',
  compat: null,
}

export type EngineInputField = {
  field: string
  kind: 'applicant' | 'derived' | 'reference'
  type: string
  programs: string[]
  definition?: string
  /** How the engine turns this applicant-natural input into its internal fact.
   *  Present only for `derived` fields. */
  derivation?: string
  /** snake_case enum values when the input is enum-typed. */
  values?: string[]
  citations: Array<{ document: string; pages: number[] }>
  /** True when a field with the same meaning happens to exist in the partner's
   *  published worker-portal contract. Informational only. */
  alignsWithPartnerContract: boolean
}

export type EngineInputGroup = { title: string; fields: EngineInputField[] }

export type EngineInputsDoc = {
  $comment: string
  about: string
  coverage: string
  kinds: Record<string, string>
  groups: EngineInputGroup[]
}

export function buildEngineInputs(): EngineInputsDoc {
  const data = buildDictionaryData()
  const groups: EngineInputGroup[] = data.groups
    .map((group) => ({
      title: group.title,
      fields: group.entries
        .map((e): EngineInputField | null => {
          const kind = KIND[e.kind]
          if (!kind) return null
          return {
            field: e.field,
            kind,
            type: e.type,
            programs: e.programs,
            definition: e.definition?.replace(/\s+/g, ' ').trim(),
            derivation: kind === 'derived' ? e.note : undefined,
            values: e.values,
            citations: e.citations.map((c) => ({
              document: c.title,
              pages: c.pages,
            })),
            alignsWithPartnerContract: e.inPublishedContract,
          }
        })
        .filter((f): f is EngineInputField => f !== null),
    }))
    .filter((g) => g.fields.length > 0)

  return {
    $comment:
      'GENERATED FILE — do not edit by hand. Source: scripts/generate-engine-inputs.ts (joins the rulesets with src/v2-field-map.ts). Regenerate: npm run gen:engine-inputs.',
    about:
      'Canonical catalog of every input the rules engine accepts. The rules engine is the source of truth; build your data model to match these fields. Field semantics, types, enum vocabularies, and policy citations are the rule authors\' own words, pulled directly from the rulesets.',
    coverage:
      'SNAP is a near-complete implementation of the program, so its inputs are exhaustive. Medicaid is a basic, illustrative subset — its input list is a sketch, not the full program.',
    kinds: {
      applicant: 'A value you provide, used as-is.',
      derived:
        'A value you provide in an applicant-natural form (e.g. dateOfBirth); the engine derives its internal fact (e.g. age). See each field\'s derivation note.',
      reference:
        'An identity/linking handle (member ids and cross-references), not a fact value.',
    },
    groups,
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
