/**
 * Instanced missing-inputs — THE v2 `missingInputs` shape: one entry per
 * concrete INSTANCE, where each entry carries two orthogonal addresses —
 *
 *   `requestPath` — the schema address: which question is unanswered
 *                   (`members[].income[].amount`);
 *   `at`          — the instance address: an ordered chain of
 *                   `{in: <collection>, id: <row id>}` hops from the root of
 *                   the request document down to the row that owes the value.
 *                   Empty = a household-level scalar.
 *
 * Scope stops being a special field (household = 0 hops, member = 1, row = 2,
 * depth N costs nothing), and collections that don't belong to a member
 * (caregiverRelationships) address cleanly where a memberId-centric shape
 * cannot.
 *
 * A second entry kind makes the acknowledgment rule visible instead of
 * doc-only: `kind: "unacknowledged"` says a whole collection question is
 * unanswered ("does this member have any income? send rows or []") — and it
 * recurses to the root: an empty request's first missing input is literally
 * `{ field: "members", at: [] }`.
 *
 * Migration crutches (remove once integrators confirm they're off them):
 * `memberId` echoes `at[0].id` when the first hop is members, and the
 * deprecated `missingInputsByMember` response field stays attached.
 */
import type { Model } from 'rules-visualizer-shared-types'

import type { MissingInputInstance } from '../evaluate.js'
import {
  indexForModel,
  requestPath,
  requestKeyForRoot,
} from './field-index.js'

export type InstanceHop = {
  /** Request-vocabulary collection key: members, income, expenses, jobs,
   *  assets, caregiverRelationships. */
  in: string
  /** The caller-assigned row id (or the positional fallback). */
  id: string
}

export type InstancedMissing = {
  /** `field`: a concrete value is missing at `at`. `unacknowledged`: a whole
   *  collection question is unanswered at `at` — answer with rows or []. */
  kind: 'field' | 'unacknowledged'
  /** Schema address — where the field lives in the request body. */
  requestPath: string
  field: string
  location?: string
  type?: string
  label?: string
  options?: string[]
  /** Instance address — hops from the request root to the owing row.
   *  Empty for household-level entries. */
  at: InstanceHop[]
  /** Echo of `at[0].id` when the first hop is members — a deprecation
   *  crutch for groupBy-by-member consumers. */
  memberId?: string
  /** On `unacknowledged` entries: how to answer. */
  hint?: string
}

/** The acknowledgment state translateRequest reports. */
type Acknowledgment = {
  byKey: Record<string, string[]>
  caregiverRelationshipsProvided: boolean
}

const SUB_COLLECTION_KEYS = ['income', 'expenses', 'jobs', 'assets'] as const

/**
 * Compose the full instanced list for one evaluation: unacknowledged
 * collection entries first (the biggest asks), then per-instance field
 * entries in engine order.
 *
 * Suppression falls out of construction rather than filtering: the engine
 * only emits instances it can attribute, and a withheld or absent collection
 * has no rows to attribute to — so its per-field union entries simply have
 * no instanced counterpart, and the `unacknowledged` entry stands in for
 * all of them.
 */
export function composeInstancedMissing(
  query: {
    missingInputs?: Array<{ path: string }>
    missingInputInstances?: MissingInputInstance[]
  },
  memberIds: string[],
  acknowledgment: Acknowledgment,
  model: Model
): InstancedMissing[] {
  const byPath = new Map(indexForModel(model).map((e) => [e.enginePath, e]))
  const out: InstancedMissing[] = []

  // Locations needed per the union — drives which collection questions to ask.
  const neededLocations = new Set<string>()
  for (const m of query.missingInputs ?? []) {
    const entry = byPath.get(m.path)
    if (entry) neededLocations.add(entry.location)
  }
  const memberDataNeeded = [...neededLocations].some((l) =>
    l.startsWith('members[]')
  )

  if (memberIds.length === 0 && memberDataNeeded) {
    // The root case: nothing member-shaped can be attributed until the
    // household roster exists.
    out.push({
      kind: 'unacknowledged',
      requestPath: 'members',
      field: 'members',
      at: [],
      hint: 'Send the household members list — one object per person, each with an id.',
    })
  } else {
    for (const key of SUB_COLLECTION_KEYS) {
      if (!neededLocations.has(`members[].${key}[]`)) continue
      const acked = new Set(acknowledgment.byKey[key] ?? [])
      for (const memberId of memberIds) {
        if (acked.has(memberId)) continue
        out.push({
          kind: 'unacknowledged',
          requestPath: `members[].${key}`,
          field: key,
          at: [{ in: 'members', id: memberId }],
          memberId,
          hint: `Send ${key} rows for this member, or [] if they have none.`,
        })
      }
    }
  }

  if (
    neededLocations.has('caregiverRelationships[]') &&
    !acknowledgment.caregiverRelationshipsProvided
  ) {
    out.push({
      kind: 'unacknowledged',
      requestPath: 'caregiverRelationships',
      field: 'caregiverRelationships',
      at: [],
      hint: 'Send the caregiver relationships list, or [] if there are none.',
    })
  }

  // Per-instance field entries, deduped by (path, address).
  const seen = new Set<string>()
  for (const inst of query.missingInputInstances ?? []) {
    const entry = byPath.get(inst.path)
    if (!entry || entry.kind === 'implied') continue
    const at: InstanceHop[] = []
    let unmappable = false
    for (const hop of inst.hops) {
      const key = requestKeyForRoot(hop.root)
      if (!key) {
        unmappable = true
        break
      }
      at.push({ in: key, id: hop.id })
    }
    if (unmappable) continue
    const dedupeKey = `${inst.path}|${at.map((h) => `${h.in}:${h.id}`).join('/')}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    const memberId = at[0]?.in === 'members' ? at[0].id : undefined
    out.push({
      kind: 'field',
      requestPath: requestPath(entry),
      field: entry.field,
      location: entry.location,
      type: entry.type,
      label: entry.name,
      ...(entry.values ? { options: entry.values } : {}),
      at,
      ...(memberId !== undefined ? { memberId } : {}),
    })
  }

  return out
}

/** The subset of an instanced list that belongs on one member-scoped
 *  determination: household-level entries (empty `at`) plus entries whose
 *  first hop is that member. Mirrors the default format's own-plus-shared
 *  composition rule. */
export function instancedForMember(
  entries: InstancedMissing[],
  memberId: string
): InstancedMissing[] {
  return entries.filter(
    (e) =>
      e.at.length === 0 || (e.at[0].in === 'members' && e.at[0].id === memberId)
  )
}
