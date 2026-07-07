/**
 * Shared evaluation core.
 *
 * The generic `/query` route and the domain-oriented eligibility adapter
 * routes both reduce to the same operation: run a Fact Graph ruleset
 * against partial input, then report resolved values plus — when
 * anything is still missing — the writables the caller would have to
 * supply to finish. That logic lives here so the adapter endpoints are
 * thin translators (ORCA request shape → these inputs → ProgramDecision)
 * rather than a second copy of the execution-and-missing-inputs walk.
 *
 * `runQuery` is transport-agnostic: it takes an already-resolved model +
 * facts and returns a structured result. Callers map that onto HTTP.
 * Execution failures are thrown (so the caller can decide the status);
 * unknown targets come back as a discriminated result because their
 * meaning differs by caller — a typo in a `/query` body is a 404, but a
 * bad target produced by our own translation layer is a 500.
 */
import { executeFactGraph } from 'rules-visualizer-factgraph-core'
import type { RawFact } from 'rules-visualizer-factgraph-core'
import type { Model, ModelNode } from 'rules-visualizer-shared-types'

import {
  buildTrace,
  buildDecidingPath,
  type TraceNode,
  type DecidingPath,
} from './explain.js'
import { getModelIndex } from './model-index.js'

// ---------------------------------------------------------------------------
// Response types (shared with the /query route's wire contract)
// ---------------------------------------------------------------------------

/** A value for a per-member fact, one entry per row in the source collection.
 *  Mirrors the input shape (`inputs[<collection-root>][n].id`). */
export type PerMemberValue = Array<{ memberId: string; value: unknown }>

/** A response-side fact value. Scalar facts return a primitive; per-member
 *  facts (paths containing `/*`) return a PerMemberValue array. */
export type FactValue = unknown | PerMemberValue

export type MissingInput = {
  path: string
  name: string
  description?: string
  /** Writable fact-graph type name (e.g. "Dollar", "Boolean", "Int", "Enum"). */
  dataType: string
  /** Present when dataType is "Enum" — the allowed values, when statically
   *  resolvable from the EnumOptions target. */
  enumOptions?: string[]
}

/** One hop of an instance address: which collection, which row. `root` is the
 *  engine collection root (`/members`, `/incomes`, …); `id` is the caller's
 *  row id (or the positional fallback). */
export type MissingInputHop = { root: string; id: string }

/** A missing input addressed to a concrete instance — the same field metadata
 *  as MissingInput plus WHERE: an ordered hop chain from the household root
 *  down to the row that lacks the value. Empty hops = a household-level
 *  scalar. Experimental (include: "missingInputInstances"). */
export type MissingInputInstance = MissingInput & { hops: MissingInputHop[] }

export type SupportingFact = {
  path: string
  name: string
  value: FactValue
}

export type QueryResponse = {
  status: 'complete' | 'incomplete'
  rulesetVersion: string
  /** Echoed unchanged from the request. Omitted if the request didn't send one. */
  metadata?: unknown
  /** One entry per requested target. Value is null when the engine couldn't
   *  resolve that target with the provided inputs. */
  values: Record<string, FactValue | null>
  /** Present iff status === "incomplete". Union across all unresolved targets. */
  missingInputs?: MissingInput[]
  /** Present iff request.include contains "supportingFacts". */
  supportingFacts?: SupportingFact[]
  /** Present iff request.include contains "trace". One entry per
   *  requested target, keyed by target path. */
  traces?: Record<string, TraceNode>
  /** Present iff request.include contains "trace". For each target, a
   *  compact array of path-bearing nodes from the target down to the
   *  single deciding leaf. */
  decidingPaths?: Record<string, DecidingPath>
  /** Present iff status === "incomplete" and a /members collection was
   *  provided. Maps each member ID to the member-level writables still
   *  unresolved for that member specifically. Scalar/household-level
   *  missing inputs remain in the top-level `missingInputs` union only. */
  missingInputsByMember?: Record<string, MissingInput[]>
  /** EXPERIMENTAL — present iff status === "incomplete" and request.include
   *  contains "missingInputInstances". The union re-expressed per concrete
   *  instance: one entry per (field, row) with a hop-chain address, instead
   *  of one deduped entry per field. Fields the engine cannot attribute to
   *  any instance (e.g. member fields when no members were provided) are
   *  omitted here — they remain in `missingInputs`. */
  missingInputInstances?: MissingInputInstance[]
}

/**
 * The validated, transport-neutral inputs to an evaluation. The `inputs`
 * map is the unified path → value shape (scalars and collection row-sets
 * keyed the same way); see `splitInputs`.
 */
export type QueryInput = {
  targets: string[]
  inputs?: Record<string, unknown>
  include?: string[]
  metadata?: unknown
}

export type EvaluateResult =
  | { ok: true; response: QueryResponse }
  | { ok: false; code: 'unknown-targets'; unknownTargets: string[] }

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Evaluate one or more fact-graph nodes against partial input.
 *
 * Returns `{ ok: false, code: 'unknown-targets' }` when any requested
 * target doesn't exist in the model — the caller decides whether that's
 * a 404 (caller typo) or a 500 (our translation bug). Throws if the
 * engine itself fails to execute; the caller should surface that as a
 * 500.
 *
 * Missing-inputs detection runs the engine with whatever was provided,
 * then walks the dependency graph of each unresolved target. Subtrees
 * whose root already resolved are pruned. Unprovided collections are
 * propagated backward through the reverse-dependency graph so the
 * executor's "0 members" defaults don't silently suppress required
 * member-level fields. See `collectMissingInputs` and
 * `clearUnprovidedCollectionSubtrees`.
 */
export function runQuery(
  rulesetId: string,
  model: Model,
  facts: RawFact[],
  input: QueryInput
): EvaluateResult {
  const targets = input.targets

  const unknownTargets = targets.filter((t) => !findNodeByPath(model, t))
  if (unknownTargets.length > 0) {
    return { ok: false, code: 'unknown-targets', unknownTargets }
  }

  // The unified `inputs` map separates into scalars and collections for
  // the executor, which still wants them apart.
  const { scalars, collections } = splitInputs(input.inputs)
  const includeSet = new Set(input.include ?? [])
  const wantSupportingFacts = includeSet.has('supportingFacts')
  const wantTraces = includeSet.has('trace')

  // Capture caller-provided member IDs per collection and strip the id
  // field before forwarding to the executor (which doesn't use it). If a
  // row didn't supply one, fall back to a positional id so every member
  // is still addressable in the response.
  const memberIdsByCollection: Record<string, string[]> = {}
  const entitiesForExecutor: Record<string, Array<Record<string, unknown>>> = {}
  for (const [collPath, rows] of Object.entries(collections)) {
    const ids: string[] = []
    const cleaned: Array<Record<string, unknown>> = []
    rows.forEach((row, idx) => {
      const rawId = typeof row.id === 'string' ? row.id : ''
      const memberId = rawId.length > 0 ? rawId : 'member-' + idx
      ids.push(memberId)
      const { id: _discard, ...rest } = row
      void _discard
      cleaned.push(rest)
    })
    memberIdsByCollection[collPath] = ids
    entitiesForExecutor[collPath] = cleaned
  }

  // For sub-collections that have a memberId foreign key (income, assets,
  // expenses, jobs), build a map: collection root → member index → their row
  // indices. This lets the per-member missing-inputs walker check only rows
  // belonging to a given member rather than treating the flat row array as
  // member-indexed.
  const subCollMemberRows = new Map<string, Map<number, number[]>>()
  for (const [collPath, rows] of Object.entries(entitiesForExecutor)) {
    if (collPath === '/members') continue
    const memberToRows = new Map<number, number[]>()
    rows.forEach((row, rowIdx) => {
      const memberIdKey = Object.keys(row).find((k) => k.endsWith('/memberId'))
      if (!memberIdKey) return
      const ref = row[memberIdKey] as string // '#0', '#1', …
      const memberIdx = parseInt(ref.slice(1), 10)
      if (isNaN(memberIdx)) return
      const existing = memberToRows.get(memberIdx) ?? []
      existing.push(rowIdx)
      memberToRows.set(memberIdx, existing)
    })
    if (memberToRows.size > 0) subCollMemberRows.set(collPath, memberToRows)
  }

  const executionResults = executeFactGraph(
    rulesetId,
    facts,
    scalars,
    model.nodes as Record<string, { content: { dataType?: string } }>,
    entitiesForExecutor
  )

  const effectiveResults = clearUnprovidedCollectionSubtrees(
    model,
    executionResults,
    new Set(Object.keys(entitiesForExecutor))
  )

  // Compose the values map: one entry per requested target. Null if
  // the engine couldn't resolve that target with the provided inputs.
  // A per-member target with unresolved slots ([36, null]) is shaped and
  // returned, but still counts as unresolved for `status` — "complete"
  // must mean every requested value, for every row.
  const values: Record<string, FactValue | null> = {}
  const unresolvedTargetSet = new Set<string>()
  for (const target of targets) {
    const raw = effectiveResults[target]
    if (raw === undefined || raw === null) {
      values[target] = null
      unresolvedTargetSet.add(target)
    } else {
      values[target] = shapeFactValue(target, raw, memberIdsByCollection)
      if (!hasResolvedValue(raw)) unresolvedTargetSet.add(target)
    }
  }
  const allResolved = unresolvedTargetSet.size === 0

  // Set of paths the caller explicitly supplied — used by the missing-
  // inputs walker so we don't list inputs the caller already provided.
  const providedInputPaths = new Set<string>(Object.keys(scalars))
  for (const rows of Object.values(collections)) {
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (key === 'id') continue
        providedInputPaths.add(key)
      }
    }
  }

  const response: QueryResponse = {
    status: allResolved ? 'complete' : 'incomplete',
    rulesetVersion: rulesetId,
    values,
  }

  if (input.metadata !== undefined) {
    response.metadata = input.metadata
  }

  if (wantSupportingFacts) {
    response.supportingFacts = collectSupportingFacts(
      model,
      targets,
      effectiveResults,
      memberIdsByCollection
    )
  }

  if (wantTraces) {
    const index = getModelIndex(model)
    const traces: Record<string, TraceNode> = {}
    const decidingPaths: Record<string, DecidingPath> = {}
    for (const target of targets) {
      const t = buildTrace(
        model,
        index,
        effectiveResults,
        target,
        memberIdsByCollection
      )
      if (t) {
        traces[target] = t
        decidingPaths[target] = buildDecidingPath(t)
      }
    }
    response.traces = traces
    response.decidingPaths = decidingPaths
  }

  if (!allResolved) {
    // Union of missing inputs across every unresolved target, deduped by
    // path because the same writable may surface for multiple targets and
    // the UI only needs one prompt per field.
    const allMissing = new Map<string, MissingInput>()
    for (const target of targets) {
      if (!unresolvedTargetSet.has(target)) continue
      for (const m of collectMissingInputs(
        model,
        target,
        providedInputPaths,
        effectiveResults
      )) {
        if (!allMissing.has(m.path)) allMissing.set(m.path, m)
      }
    }
    response.missingInputs = [...allMissing.values()]

    // Per-member attribution: run a member-aware walk for each member so
    // a field provided by member A is not falsely omitted from member B's
    // list. The cross-member providedPaths set can only tell us that *some*
    // member provided a field — the per-slot execution result tells us
    // whether THIS member still needs it.
    //
    // Walk from ALL unresolved targets (not just per-member ones): for
    // programs like SNAP whose targets are household-level aggregates,
    // the walker still reaches member-level writables transitively and
    // correctly attributes them per slot.
    const memberIds = memberIdsByCollection['/members'] ?? []
    const byMember: Record<string, MissingInput[]> = {}
    if (memberIds.length > 0) {
      const unresolvedTargets = targets.filter((t) => unresolvedTargetSet.has(t))
      for (let idx = 0; idx < memberIds.length; idx++) {
        const memberId = memberIds[idx]
        // Slice subCollMemberRows to this member's row indices only.
        const memberSubCollRows = new Map<string, number[]>()
        for (const [root, memberMap] of subCollMemberRows) {
          const rows = memberMap.get(idx)
          if (rows && rows.length > 0) memberSubCollRows.set(root, rows)
        }
        const memberMissing = new Map<string, MissingInput>()
        for (const target of unresolvedTargets) {
          for (const m of collectMissingInputsForMember(
            model,
            target,
            providedInputPaths,
            effectiveResults,
            idx,
            memberSubCollRows
          )) {
            if (!memberMissing.has(m.path)) memberMissing.set(m.path, m)
          }
        }
        if (memberMissing.size > 0) byMember[memberId] = [...memberMissing.values()]
      }
      if (Object.keys(byMember).length > 0) {
        response.missingInputsByMember = byMember
      }
    }

    if (includeSet.has('missingInputInstances')) {
      response.missingInputInstances = buildMissingInputInstances(
        allMissing,
        byMember,
        collections,
        memberIdsByCollection,
        effectiveResults
      )
    }
  }

  return { ok: true, response }
}

/**
 * Re-express the missing-inputs union per concrete instance: one entry per
 * (field, row) with a hop-chain address instead of one deduped entry per
 * field. Experimental — behind include: "missingInputInstances".
 *
 * Three sources, disjoint by construction:
 *   - household scalars: union entries with no collection wildcard → hops [];
 *   - member fields: the per-member walk's `/members/*\/…` entries → one hop;
 *   - sub-collection row fields: a per-row pass over the provided rows —
 *     a row owes a field when it didn't supply the key AND its executor slot
 *     is unresolved — attributed through the row's memberId back-link → two
 *     hops (one when the collection has no member back-link, e.g.
 *     caregiver relationships).
 *
 * Union entries the engine cannot attribute to any instance (member fields
 * when no members were provided, fields of withheld collections) are omitted;
 * the caller composes "unacknowledged" entries for those from the request's
 * acknowledgment state.
 */
function buildMissingInputInstances(
  union: Map<string, MissingInput>,
  byMember: Record<string, MissingInput[]>,
  collections: Record<string, Array<Record<string, unknown>>>,
  memberIdsByCollection: Record<string, string[]>,
  executionResults: Record<string, unknown>
): MissingInputInstance[] {
  const out: MissingInputInstance[] = []
  const collectionRootOf = (path: string): string | undefined =>
    path.match(/^(\/[^*]+?)\/\*\//)?.[1]

  for (const m of union.values()) {
    if (collectionRootOf(m.path) === undefined) out.push({ ...m, hops: [] })
  }

  for (const [memberId, list] of Object.entries(byMember)) {
    for (const m of list) {
      if (m.path.startsWith('/members/*/')) {
        out.push({ ...m, hops: [{ root: '/members', id: memberId }] })
      }
    }
  }

  // Candidate row-field paths must come from the member-aware walk, not the
  // union: the union dedupes at path level, so a field that SOME rows
  // provided (providedInputPaths has it) never enters the union even though
  // other rows still owe it. The per-member walk is slot-aware and lists
  // those. Union entries are merged in as a fallback for /query callers
  // that provided a sub-collection without /members.
  const rowCandidates = new Map<string, MissingInput>()
  for (const list of Object.values(byMember)) {
    for (const m of list) {
      const r = collectionRootOf(m.path)
      if (r && r !== '/members') rowCandidates.set(m.path, m)
    }
  }
  for (const m of union.values()) {
    const r = collectionRootOf(m.path)
    if (r && r !== '/members' && !rowCandidates.has(m.path)) {
      rowCandidates.set(m.path, m)
    }
  }

  const memberIds = memberIdsByCollection['/members'] ?? []
  for (const [root, rows] of Object.entries(collections)) {
    if (root === '/members') continue
    const rowIds = memberIdsByCollection[root] ?? []
    const paths = [...rowCandidates.keys()].filter((p) =>
      p.startsWith(root + '/*/')
    )
    if (paths.length === 0) continue
    rows.forEach((row, rowIdx) => {
      for (const p of paths) {
        if (p in row) continue
        const raw = executionResults[p]
        const slot = Array.isArray(raw) ? raw[rowIdx] : undefined
        if (slot !== null && slot !== undefined) continue
        const hops: MissingInputHop[] = []
        const fk = row[`${root}/*/memberId`]
        if (typeof fk === 'string' && fk.startsWith('#')) {
          const mIdx = parseInt(fk.slice(1), 10)
          if (!isNaN(mIdx)) {
            hops.push({ root: '/members', id: memberIds[mIdx] ?? `member-${mIdx}` })
          }
        }
        hops.push({ root, id: rowIds[rowIdx] ?? `member-${rowIdx}` })
        out.push({ ...rowCandidates.get(p)!, hops })
      }
    })
  }

  return out
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Split a unified `inputs` map into the {scalars, collections} shape the
 * executor expects internally. A value that's a JSON array becomes a
 * collection row-set; anything else is a scalar.
 */
export function splitInputs(unified: Record<string, unknown> | undefined): {
  scalars: Record<string, unknown>
  collections: Record<string, Array<Record<string, unknown>>>
} {
  const scalars: Record<string, unknown> = {}
  const collections: Record<string, Array<Record<string, unknown>>> = {}
  if (!unified) return { scalars, collections }
  for (const [key, value] of Object.entries(unified)) {
    if (Array.isArray(value)) {
      // Defensive: ensure every element is an object so downstream logic
      // doesn't blow up on arrays of primitives at a collection key.
      const rows = value.filter(
        (r): r is Record<string, unknown> =>
          typeof r === 'object' && r !== null && !Array.isArray(r)
      )
      collections[key] = rows
    } else {
      scalars[key] = value
    }
  }
  return { scalars, collections }
}

function findNodeByPath(model: Model, path: string): ModelNode | undefined {
  return getModelIndex(model).pathToNode.get(path)
}

/**
 * Shape a raw executor value for the response.
 *
 * Scalar facts pass through unchanged. Per-member facts (paths whose
 * middle segment is the collection wildcard) come back from the executor
 * as positional arrays; we zip them with the caller-provided (or
 * auto-generated) member IDs so the caller can correlate values to the
 * right row without depending on order.
 */
function shapeFactValue(
  path: string,
  raw: unknown,
  memberIdsByCollection: Record<string, string[]>
): FactValue {
  const collMatch = path.match(/^(\/[^*]+?)\/\*\//)
  if (!collMatch) return raw
  if (!Array.isArray(raw)) return raw

  const root = collMatch[1]
  const memberIds = memberIdsByCollection[root] ?? []
  return raw.map((value, idx) => ({
    memberId: memberIds[idx] ?? `member-${idx}`,
    value,
  }))
}

/**
 * Remove from execution results every value that was computed against an
 * unprovided collection — both directly (the per-member writables and the
 * collection placeholder itself) and transitively (every derived fact that
 * statically depends on those paths).
 *
 * The Fact Graph executor treats a missing collection as a zero-row
 * collection: `/members` becomes `"0 members"`, `/householdSize` becomes
 * `0`, downstream gates like `/hasEligiblePerson` resolve to `false`.
 * That's a defensible engine semantic, but it makes the API report "this
 * is complete" when the caller has simply not gotten to the household-
 * members section of their form yet. Strip those values so the walker
 * treats the affected subtree as still-needing-input.
 *
 * Implementation: identify writables under each unprovided collection
 * (seed set), then BFS outward through the reverse-dependency graph
 * deleting every visited path. O(nodes + edges) per request.
 */
function clearUnprovidedCollectionSubtrees(
  model: Model,
  results: Record<string, unknown>,
  providedCollectionPaths: Set<string>
): Record<string, unknown> {
  const index = getModelIndex(model)

  const unprovidedRoots: string[] = []
  for (const root of index.collectionRoots) {
    if (!providedCollectionPaths.has(root)) unprovidedRoots.push(root)
  }
  if (unprovidedRoots.length === 0) return results

  const seeds: ModelNode[] = []
  for (const root of unprovidedRoots) {
    const bucket = index.collectionRootSeeds.get(root)
    if (bucket) seeds.push(...bucket)
  }

  const cleaned = { ...results }
  const visited = new Set<string>()
  const queue: ModelNode[] = [...seeds]
  while (queue.length > 0) {
    const node = queue.shift()!
    if (visited.has(node.id)) continue
    visited.add(node.id)

    const c = node.content
    if (c.type !== 'entity' && 'path' in c) {
      delete cleaned[c.path]
    }

    for (const consId of index.reverseDeps.get(node.id) ?? []) {
      const consNode = model.nodes[consId]
      if (consNode) queue.push(consNode)
    }
  }

  return cleaned
}

/**
 * Walk the target's transitive dependency tree to find writable inputs
 * still needed for the target to compute.
 *
 * Execution-aware: at each node we check the partial execution results.
 * If a fact already has a value, its dependency subtree is no longer
 * required for THIS target and we stop descending. This makes
 * short-circuit operators (`Any`, `Switch`) correctly shrink the
 * asked-for set.
 *
 * Cycles are guarded with a visited set so a malformed graph doesn't
 * loop forever.
 */
function collectMissingInputs(
  model: Model,
  targetPath: string,
  providedPaths: Set<string>,
  executionResults: Record<string, unknown>
): MissingInput[] {
  const targetNode = findNodeByPath(model, targetPath)
  if (!targetNode) return []

  const visited = new Set<string>()
  const missing: MissingInput[] = []

  const walk = (node: ModelNode) => {
    if (visited.has(node.id)) return
    visited.add(node.id)

    const content = node.content
    if (content.type === 'entity' || !('path' in content)) return

    if (hasResolvedValue(executionResults[content.path])) return

    if (content.type === 'writable') {
      if (!providedPaths.has(content.path)) {
        missing.push({
          path: content.path,
          name: content.label ?? node.name,
          description: node.description,
          dataType: content.typeName,
          enumOptions: content.enumOptions,
        })
      }
      return
    }

    for (const depId of node.dependencies) {
      const dep = model.nodes[depId]
      if (dep) walk(dep)
    }
  }

  walk(targetNode)
  return missing
}

/**
 * Member-aware variant of collectMissingInputs. For collection-scoped paths
 * (paths with a wildcard segment) checks only the given member's positional
 * slot in the executor's results array rather than the whole array. This
 * correctly attributes a missing field to a specific member even when other
 * members in the same collection have already provided that field.
 *
 * The cross-member `providedPaths` set can tell us that *some* member provided
 * a path, but not which one. For collection paths we therefore rely solely on
 * the per-slot execution result; for scalar paths the normal `providedPaths`
 * check still applies.
 */
function collectMissingInputsForMember(
  model: Model,
  targetPath: string,
  providedPaths: Set<string>,
  executionResults: Record<string, unknown>,
  memberIndex: number,
  memberSubCollRows?: Map<string, number[]>
): MissingInput[] {
  const MEMBER_PREFIX = '/members/*/'

  const targetNode = findNodeByPath(model, targetPath)
  if (!targetNode) return []

  const visited = new Set<string>()
  const missing: MissingInput[] = []

  const walk = (node: ModelNode) => {
    if (visited.has(node.id)) return
    visited.add(node.id)

    const content = node.content
    if (content.type === 'entity' || !('path' in content)) return

    const path = content.path as string
    const isMemberPath = path.startsWith(MEMBER_PREFIX)

    // Collection root for sub-collection paths: /incomes/*/amount → /incomes.
    // Undefined for top-level scalars/aggregates that have no second slash.
    const collRootSlash = path.indexOf('/', 1)
    const collRoot = !isMemberPath && collRootSlash > 0 ? path.slice(0, collRootSlash) : undefined

    const raw = executionResults[path]
    let effectiveValue: unknown

    if (isMemberPath && Array.isArray(raw)) {
      // Direct member field — check this member's positional slot.
      effectiveValue = raw[memberIndex]
    } else if (collRoot !== undefined && memberSubCollRows) {
      // Sub-collection field (income, assets, etc.).
      // Only attribute to this member if they contributed rows; if they have
      // no rows for this collection it is not their field to fill.
      const memberRows = memberSubCollRows.get(collRoot)
      if (memberRows !== undefined) {
        // Resolved for this member only when all of their rows have a value.
        const allResolved =
          Array.isArray(raw) &&
          memberRows.every((i) => hasResolvedValue((raw as unknown[])[i]))
        effectiveValue = allResolved ? memberRows : null
      } else {
        // Member has no rows for this collection — treat as resolved so we
        // skip this subtree (their income/assets are not missing, they just
        // didn't provide any rows).
        effectiveValue = true
      }
    } else {
      // Scalar or household-level aggregate — use the raw execution result so
      // the walker can continue descending into its dependencies normally.
      effectiveValue = raw
    }

    if (hasResolvedValue(effectiveValue)) return

    if (content.type === 'writable') {
      // Only attribute writables that belong to this member's scope:
      //   - direct /members/*/ fields, or
      //   - sub-collection rows this member contributed
      if (!isMemberPath && !(collRoot !== undefined && memberSubCollRows?.has(collRoot))) return
      missing.push({
        path,
        name: content.label ?? node.name,
        description: node.description,
        dataType: content.typeName,
        enumOptions: content.enumOptions,
      })
      return
    }

    for (const depId of node.dependencies) {
      const dep = model.nodes[depId]
      if (dep) walk(dep)
    }
  }

  walk(targetNode)
  return missing
}

/**
 * Whether an execution-results value counts as "this fact resolved."
 *
 * Scalars: any defined, non-null value is resolved.
 * Collection-item arrays: resolved when every element has a value, including
 * the vacuous case of zero elements. An empty array can only reach this
 * function when the collection was explicitly provided as empty (e.g.
 * income: []) — clearUnprovidedCollectionSubtrees deletes unprovided
 * collection facts entirely, leaving undefined rather than []. A partially-
 * populated collection ([value, null, value]) is not resolved.
 */
function hasResolvedValue(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (Array.isArray(value)) {
    return value.every((v) => v !== null && v !== undefined)
  }
  return true
}

/**
 * Collect supporting facts across one or more targets. Walks each
 * target's transitive dependency tree, dedupes by path, and shapes
 * per-member values into the `{memberId, value}` arrays the response
 * contract uses.
 *
 * Capped at MAX_FACTS so a request that targets a deep graph doesn't
 * return the entire ruleset's worth of intermediate values. Callers
 * who need everything should hit the schema endpoint instead.
 */
function collectSupportingFacts(
  model: Model,
  targetPaths: string[],
  results: Record<string, unknown>,
  memberIdsByCollection: Record<string, string[]>
): SupportingFact[] {
  const visited = new Set<string>()
  const out: SupportingFact[] = []
  const MAX_FACTS = 200

  const walk = (node: ModelNode) => {
    if (out.length >= MAX_FACTS) return
    if (visited.has(node.id)) return
    visited.add(node.id)

    const content = node.content
    if (content.type !== 'entity' && 'path' in content) {
      const value = results[content.path]
      if (value !== undefined && value !== null) {
        out.push({
          path: content.path,
          name: 'label' in content ? (content.label ?? node.name) : node.name,
          value: shapeFactValue(content.path, value, memberIdsByCollection),
        })
      }
    }

    for (const depId of node.dependencies) {
      const dep = model.nodes[depId]
      if (dep) walk(dep)
    }
  }

  for (const target of targetPaths) {
    const node = findNodeByPath(model, target)
    if (node) walk(node)
  }
  return out
}
