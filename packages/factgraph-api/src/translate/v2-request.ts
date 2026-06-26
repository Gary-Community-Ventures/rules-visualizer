/**
 * Translate the friendly v2 request DTO into the engine's path-keyed inputs,
 * driven entirely by the field index (src/translate/field-index.ts) — so it
 * stays in lockstep with the catalog and the rules.
 *
 * Pure no-guess: only fields the caller actually provided are emitted. Anything
 * absent is left unset, so the engine reports it as still-needed rather than
 * having a value invented for it.
 *
 * Identity: the caller assigns each member (and optionally each sub-collection
 * row) an `id`. We keep that id on the engine row for response correlation and
 * link collections by the engine's positional `#N` form — the caller never
 * sees `#N`. Reference fields (spouse, sponsor, caregiver, dependent) carry
 * another row's caller id and are resolved to `#N` here.
 */
import type { Model, ModelNode } from 'rules-visualizer-shared-types'

import { indexForModel, type FieldEntry } from './field-index.js'

export type TranslateResult = {
  inputs: Record<string, unknown>
  /** Caller member ids in request order — index i is engine `#i`. */
  memberIds: string[]
  /** Non-fatal notes: unknown fields, unmapped enum values. */
  warnings: string[]
}

type Maps = {
  /** `${location}|${field}` → field entry. */
  byField: Map<string, FieldEntry>
  /** engine path → (snake_case value → engine enum option). */
  enumByPath: Map<string, Map<string, string>>
}

/** Whole years between a date of birth and the evaluation date. */
function ageFromDob(dob: string, asOf: Date): number | undefined {
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return undefined
  let age = asOf.getUTCFullYear() - d.getUTCFullYear()
  const m = asOf.getUTCMonth() - d.getUTCMonth()
  if (m < 0 || (m === 0 && asOf.getUTCDate() < d.getUTCDate())) age--
  return age
}

/** Whole days between a date and the evaluation date. */
function daysSince(date: string, asOf: Date): number | undefined {
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return undefined
  return Math.floor((asOf.getTime() - d.getTime()) / 86_400_000)
}

/** Compute functions for the curated `derived` fields in field-index.ts,
 *  keyed by the DTO field name. */
const DERIVE: Record<string, (value: unknown, asOf: Date) => unknown> = {
  dateOfBirth: (v, asOf) => ageFromDob(String(v), asOf),
  pregnancyEndDate: (v, asOf) => daysSince(String(v), asOf),
}

function snake(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z])([0-9])/g, '$1_$2')
    .toLowerCase()
}

export function buildMaps(model: Model): Maps {
  const byField = new Map<string, FieldEntry>()
  for (const e of indexForModel(model)) byField.set(`${e.location}|${e.field}`, e)

  const enumByPath = new Map<string, Map<string, string>>()
  for (const node of Object.values(model.nodes) as ModelNode[]) {
    const c = node.content as { path?: string; typeName?: string; enumOptions?: string[] }
    if (c.typeName === 'Enum' && c.path && c.enumOptions) {
      const m = new Map<string, string>()
      for (const opt of c.enumOptions) m.set(snake(opt), opt)
      enumByPath.set(c.path, m)
    }
  }
  return { byField, enumByPath }
}

/** The collection root for a row path — the first segment, e.g. an income-row
 *  path resolves to "/incomes". */
function collectionRoot(enginePath: string): string {
  return '/' + enginePath.split('/')[1]
}

/**
 * Coerce one provided value for its target field: resolve reference ids to the
 * positional `#N` form, snake_case enum values to the engine option. Anything
 * unrecognised is passed through with a warning rather than dropped.
 */
function coerce(
  value: unknown,
  entry: FieldEntry,
  maps: Maps,
  indexOf: (callerId: unknown) => string | undefined,
  asOf: Date,
  warnings: string[]
): unknown {
  if (entry.kind === 'derived') {
    const fn = DERIVE[entry.field]
    if (!fn) {
      warnings.push(`${entry.location}.${entry.field}: no derivation registered — ignored.`)
      return undefined
    }
    const out = fn(value, asOf)
    if (out === undefined) {
      warnings.push(`${entry.location}.${entry.field}: ${JSON.stringify(value)} is not a valid date.`)
    }
    return out
  }
  if (entry.kind === 'reference') {
    const ref = indexOf(value)
    if (ref === undefined) {
      warnings.push(`${entry.location}.${entry.field}: no member with id ${JSON.stringify(value)} — reference left unresolved.`)
      return undefined
    }
    return ref
  }
  const enumMap = maps.enumByPath.get(entry.enginePath)
  if (enumMap && typeof value === 'string') {
    const mapped = enumMap.get(value)
    if (mapped === undefined) {
      warnings.push(`${entry.location}.${entry.field}: ${JSON.stringify(value)} is not an allowed value.`)
      return undefined
    }
    return mapped
  }
  return value
}

/** Map the provided fields of one object (a member, a row, or the household)
 *  at a given request location onto engine `path: value` pairs. */
function mapObject(
  obj: Record<string, unknown>,
  location: string,
  skip: Set<string>,
  maps: Maps,
  indexOf: (callerId: unknown) => string | undefined,
  asOf: Date,
  warnings: string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (skip.has(key) || value === undefined || value === null) continue
    const entry = maps.byField.get(`${location}|${key}`)
    if (!entry) {
      warnings.push(`${location}.${key}: not a recognised field — ignored.`)
      continue
    }
    const v = coerce(value, entry, maps, indexOf, asOf, warnings)
    if (v !== undefined) out[entry.enginePath] = v
  }
  return out
}

type V2Request = {
  household?: Record<string, unknown>
  members?: Array<Record<string, unknown>>
  caregiverRelationships?: Array<Record<string, unknown>>
}

/** Sub-collections that nest under a member, by request key → row location. */
const MEMBER_SUBCOLLECTIONS: Array<[key: string, location: string]> = [
  ['income', 'members[].income[]'],
  ['expenses', 'members[].expenses[]'],
  ['jobs', 'members[].jobs[]'],
  ['assets', 'members[].assets[]'],
]
const MEMBER_KEYS = new Set(['id', ...MEMBER_SUBCOLLECTIONS.map(([k]) => k)])

/** Translate a friendly request into one ruleset's engine inputs (no-guess).
 *  `asOf` is the evaluation date used by derived fields (age, days-since). */
export function translateRequest(req: V2Request, model: Model, asOf: Date): TranslateResult {
  const maps = buildMaps(model)
  const warnings: string[] = []
  const members = req.members ?? []

  // Caller member id → positional #N (built first so references can resolve
  // forward, e.g. a spouse listed after the head).
  const idToRef = new Map<unknown, string>()
  members.forEach((m, i) => idToRef.set(m.id ?? `member-${i}`, `#${i}`))
  const indexOf = (callerId: unknown) => idToRef.get(callerId)

  const inputs: Record<string, unknown> = {}
  const memberIds: string[] = []
  const rowsByRoot: Record<string, Array<Record<string, unknown>>> = {}

  members.forEach((m, i) => {
    const memberId = (m.id as string) ?? `member-${i}`
    memberIds.push(memberId)
    const memberRow: Record<string, unknown> = {
      id: memberId,
      ...mapObject(m, 'members[]', MEMBER_KEYS, maps, indexOf, asOf, warnings),
    }
    ;(rowsByRoot['/members'] ??= []).push(memberRow)

    for (const [key, location] of MEMBER_SUBCOLLECTIONS) {
      const rows = m[key]
      if (!Array.isArray(rows)) continue
      // Register the collection root even when rows is empty so that an explicit
      // empty array (e.g. income: []) is treated as "no income" rather than
      // "income unknown". Without this, an empty array and an absent field are
      // indistinguishable and both result in pending.
      const root = anyEntryRoot(maps, location)
      if (!root) continue
      rowsByRoot[root] ??= []
      rows.forEach((r: Record<string, unknown>, j) => {
        const row: Record<string, unknown> = {
          id: (r.id as string) ?? `${memberId}-${key}-${j}`,
          [`${root}/*/memberId`]: `#${i}`,
          ...mapObject(r, location, new Set(['id']), maps, indexOf, asOf, warnings),
        }
        rowsByRoot[root].push(row)
      })
    }
  })

  if (Array.isArray(req.caregiverRelationships)) {
    // Provided (even as []) means "this is the complete list" — seed the root
    // so the engine sees an empty collection rather than an unknown one.
    const crRoot = anyEntryRoot(maps, 'caregiverRelationships[]')
    if (crRoot) rowsByRoot[crRoot] ??= []
    for (const cr of req.caregiverRelationships) {
      if (!crRoot) break
      rowsByRoot[crRoot].push({
        id: (cr.id as string) ?? `caregiver-${rowsByRoot[crRoot].length}`,
        ...mapObject(cr, 'caregiverRelationships[]', new Set(['id']), maps, indexOf, asOf, warnings),
      })
    }
  }

  if (req.household) {
    Object.assign(inputs, mapObject(req.household, 'household', new Set(), maps, indexOf, asOf, warnings))
  }

  for (const [root, rows] of Object.entries(rowsByRoot)) inputs[root] = rows
  return { inputs, memberIds, warnings }
}

/** The engine collection root for a request location (e.g. members[].income[]
 *  → /incomes), discovered from any field at that location. */
function anyEntryRoot(maps: Maps, location: string): string | undefined {
  for (const e of maps.byField.values()) {
    if (e.location === location) return collectionRoot(e.enginePath)
  }
  return undefined
}
