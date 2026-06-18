/**
 * The single boundary that maps between the friendly external request/response
 * DTO and the engine's path-keyed inputs.
 *
 * The consumer never sees a Fact Graph path. They send named fields in nested
 * collections — `members[].hasPhysicalDisability`, `members[].income[].amount`
 * — and this module is the one place that derives that friendly identity from
 * each writable fact's path and maps it back. This is the sanctioned path↔name
 * conversion for the adapter boundary (see packages/factgraph-api/CLAUDE.md);
 * the leaf-name derivation happens here, once, with the engine path retained as
 * the canonical reference — not scattered through the codebase.
 *
 *   location   where the field sits in the request body
 *   field      the property key (the writable's path leaf)
 *   enginePath the canonical Fact Graph path it maps to
 *
 * Member-owned sub-collections (income, expenses, jobs, assets) nest *under*
 * the member in the DTO, so their `memberId` back-link is implied by nesting
 * (kind `implied`) and is never a field the consumer sets. Member→member and
 * caregiver→member links (spouse, sponsor, caregiver, dependent) are real
 * `reference` fields whose value is another row's `id`.
 */
import type { Model, ModelNode } from 'rules-visualizer-shared-types'

export type FieldKind = 'applicant' | 'reference' | 'implied'

export type FieldEntry = {
  location: string
  field: string
  enginePath: string
  name: string
  type: string
  kind: FieldKind
  values?: string[]
}

/** Engine collection prefix → request location. Most specific first. */
const LOCATIONS: Array<[prefix: string, location: string]> = [
  ['/members/*/', 'members[]'],
  ['/incomes/*/', 'members[].income[]'],
  ['/expenses/*/', 'members[].expenses[]'],
  ['/jobs/*/', 'members[].jobs[]'],
  ['/resourceItems/*/', 'members[].assets[]'],
  ['/caregiverRelationships/*/', 'caregiverRelationships[]'],
]

/** The dotted reference a consumer writes in the request body, e.g.
 *  `members[].income[].amount` or `household.earnedIncome`. */
export function requestPath(e: { location: string; field: string }): string {
  return `${e.location}.${e.field}`
}

/** PascalCase / mixed rules enum option → snake_case wire value. */
export function snakeEnum(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z])([0-9])/g, '$1_$2')
    .toLowerCase()
}

/** Split an engine path into its request (location, field). The ONLY place
 *  that turns a path into a short field name. */
export function locationAndField(enginePath: string): { location: string; field: string } {
  for (const [prefix, location] of LOCATIONS) {
    if (enginePath.startsWith(prefix)) {
      return { location, field: enginePath.slice(prefix.length) }
    }
  }
  // Scalar (no collection): a household/application-level field.
  return { location: 'household', field: enginePath.replace(/^\//, '') }
}

function kindOf(location: string, field: string, typeName: string): FieldKind {
  if (typeName !== 'CollectionItem') return 'applicant'
  // A member-owned sub-collection's link to its member is implied by nesting.
  if (field === 'memberId' && location.startsWith('members[].')) return 'implied'
  return 'reference'
}

/** Build the field index for one ruleset's writable facts. */
export function indexForModel(model: Model): FieldEntry[] {
  const out: FieldEntry[] = []
  for (const node of Object.values(model.nodes) as ModelNode[]) {
    const c = node.content as {
      type: string
      path?: string
      typeName?: string
      enumOptions?: string[]
      label?: string
    }
    if (c.type !== 'writable' || !c.path || c.typeName === 'Collection') continue
    const { location, field } = locationAndField(c.path)
    out.push({
      location,
      field,
      enginePath: c.path,
      name: c.label ?? node.name,
      type: c.typeName ?? 'Unknown',
      kind: kindOf(location, field, c.typeName ?? ''),
      values: c.enumOptions?.map(snakeEnum),
    })
  }
  return out
}
