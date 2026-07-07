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

export type FieldKind = 'applicant' | 'reference' | 'implied' | 'derived'

export type FieldEntry = {
  location: string
  field: string
  enginePath: string
  name: string
  type: string
  kind: FieldKind
  values?: string[]
  /** Present for `derived` fields: how the engine turns the applicant-natural
   *  value into its internal fact. */
  derivation?: string
}

/**
 * Curated `derived` overrides: a few engine writables are awkward or unstable
 * to send raw, so the DTO exposes an applicant-natural field instead and the
 * adapter computes the writable. Kept deliberately tiny — only facts that would
 * go stale if stored (a raw `age`) or that read better as a date. The matching
 * compute functions live in v2-request.ts.
 */
const DERIVED_OVERRIDES: Record<
  string,
  { field: string; name: string; type: string; derivation: string }
> = {
  '/members/*/age': {
    field: 'dateOfBirth',
    name: 'Date of birth',
    type: 'Date',
    derivation:
      'You send a date of birth; the engine computes age in whole years as of the evaluation date (a raw age would go stale on re-evaluation).',
  },
  '/members/*/daysSincePregnancy': {
    field: 'pregnancyEndDate',
    name: 'Pregnancy end date',
    type: 'Date',
    derivation:
      'You send the date the pregnancy ended; the engine computes days-since as of the evaluation date.',
  },
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

/** Engine collection root → the request key used in instance-hop addresses
 *  (`/members` → `members`, `/incomes` → `income`, `/caregiverRelationships`
 *  → `caregiverRelationships`). Derived from LOCATIONS so the hop vocabulary
 *  can't drift from the request vocabulary. */
export function requestKeyForRoot(root: string): string | undefined {
  if (root === '/members') return 'members'
  for (const [prefix, location] of LOCATIONS) {
    if (prefix === root + '/*/') {
      const last = location.split('.').pop() ?? location
      return last.replace('[]', '')
    }
  }
  return undefined
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

/** A still-needed input, expressed in the friendly request vocabulary so the
 *  caller knows exactly which field to set and where. */
export type FriendlyMissing = {
  requestPath: string
  field: string
  location: string
  type: string
  label: string
  options?: string[]
}

/**
 * Reverse-map the engine's missing inputs (path-keyed) into the friendly
 * request vocabulary, so a `pending` response tells the caller which DTO
 * fields to fill. Implied member back-links are dropped (the caller sets them
 * by nesting, not as fields); anything not in the index is skipped rather than
 * leaked as a raw path.
 */
export function friendlyMissing(
  missing: Array<{ path: string; name?: string; dataType?: string; enumOptions?: string[] }>,
  model: Model
): FriendlyMissing[] {
  const byPath = new Map(indexForModel(model).map((e) => [e.enginePath, e]))
  const out: FriendlyMissing[] = []
  const seen = new Set<string>()
  for (const m of missing) {
    const entry = byPath.get(m.path)
    if (!entry || entry.kind === 'implied') continue
    const rp = requestPath(entry)
    if (seen.has(rp)) continue
    seen.add(rp)
    out.push({
      requestPath: rp,
      field: entry.field,
      location: entry.location,
      type: entry.type,
      label: entry.name,
      ...(entry.values ? { options: entry.values } : {}),
    })
  }
  return out
}

/** Apply friendlyMissing to each member's missing-input list. */
export function friendlyMissingByMember(
  byMember: Record<string, Array<{ path: string; name?: string; dataType?: string; enumOptions?: string[] }>>,
  model: Model
): Record<string, FriendlyMissing[]> {
  const out: Record<string, FriendlyMissing[]> = {}
  for (const [memberId, missing] of Object.entries(byMember)) {
    const friendly = friendlyMissing(missing, model)
    if (friendly.length > 0) out[memberId] = friendly
  }
  return out
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
    const { location } = locationAndField(c.path)
    const override = DERIVED_OVERRIDES[c.path]
    if (override) {
      out.push({
        location,
        field: override.field,
        enginePath: c.path,
        name: override.name,
        type: override.type,
        kind: 'derived',
        derivation: override.derivation,
      })
      continue
    }
    const { field } = locationAndField(c.path)
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
