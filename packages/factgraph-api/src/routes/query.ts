import { Router } from 'express'
import { z } from 'zod'
import {
  getRuleset,
  getRawFacts,
  executeFactGraph,
} from 'rules-visualizer-factgraph-core'
import type { Model, ModelNode } from 'rules-visualizer-shared-types'

import {
  buildTrace,
  buildDecidingPath,
  type TraceNode,
  type DecidingPath,
} from '../explain.js'
import { getModelIndex } from '../model-index.js'

const router = Router()

// ---------------------------------------------------------------------------
// Request schema (single source of truth — request type is derived from this)
// ---------------------------------------------------------------------------

/**
 * One row of a collection (e.g. a household member). The optional `id`
 * is the caller's stable handle for this row, surfaced back in the
 * response on any per-member fact so the UI can correlate values to
 * the right member without relying on positional order. All other
 * fields are arbitrary writable-path → value pairs (e.g.
 * `/members/*\/age`).
 */
const EntityRowSchema = z
  .object({ id: z.string().min(1).optional() })
  .catchall(z.unknown())

export const QueryRequestSchema = z
  .object({
  /** Fact paths to evaluate. Always plural; pass `["/eligible"]` for a
   *  single target. The response keys `values` (and missingInputs etc.)
   *  by these paths. */
  targets: z.array(z.string().min(1)).min(1),

  /** Caller-provided values for the rules engine, keyed by fact path.
   *
   *  Scalar facts (`/grossEarnedIncome`, `/isHomeless`, `/meetsCategoricalEligibility`)
   *  take a primitive value: number, boolean, string, or date string.
   *
   *  Collection roots (`/members`, `/incomes`, `/expenses`, …) take an
   *  array of row objects. Each row supplies that row's per-member
   *  field values (keyed by their full wildcard paths,
   *  e.g. `/members/*\/age`) and an optional caller-provided `id` for
   *  correlation with per-member values in the response.
   *
   *  This single field is symmetric with the response's `values` map —
   *  same keying, same heterogeneous value shapes by path. */
  inputs: z
    .record(z.string(), z.union([z.array(EntityRowSchema), z.unknown()]))
    .optional(),

  /** Opt-in response sections. Today: `"supportingFacts"`, `"trace"`.
   *  Unknown values are ignored. */
  include: z.array(z.string()).optional(),

  /** Opaque correlation context echoed back unchanged in the response.
   *  The server does not inspect, log, or transform this field. */
  metadata: z.unknown().optional(),
  })
  // Reject unknown top-level fields so a caller using a stale shape
  // (e.g. the pre-merge `entities` field) gets a clear 400 with the
  // offending key, rather than a silent ignore and a confusing
  // "incomplete" response.
  .strict()

type QueryRequest = z.infer<typeof QueryRequestSchema>

/**
 * Split a unified `inputs` map into the {scalars, collections} shape
 * the executor expects internally. A value that's a JSON array becomes
 * a collection row-set; anything else is a scalar.
 */
function splitInputs(
  unified: Record<string, unknown> | undefined
): {
  scalars: Record<string, unknown>
  collections: Record<string, Array<Record<string, unknown>>>
} {
  const scalars: Record<string, unknown> = {}
  const collections: Record<string, Array<Record<string, unknown>>> = {}
  if (!unified) return { scalars, collections }
  for (const [key, value] of Object.entries(unified)) {
    if (Array.isArray(value)) {
      // Defensive: ensure every element is an object so downstream
      // logic doesn't blow up on arrays of primitives at a collection key.
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

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

/** A value for a per-member fact, one entry per row in the source collection.
 *  Mirrors the input shape (`entities[...][n].id`). */
type PerMemberValue = Array<{ memberId: string; value: unknown }>

/** A response-side fact value. Scalar facts return a primitive; per-member
 *  facts (paths containing `/*`) return a PerMemberValue array. */
type FactValue = unknown | PerMemberValue

type MissingInput = {
  path: string
  name: string
  description?: string
  /** Writable fact-graph type name (e.g. "Dollar", "Boolean", "Int", "Enum"). */
  dataType: string
  /** Present when dataType is "Enum" — the allowed values, when statically
   *  resolvable from the EnumOptions target. */
  enumOptions?: string[]
}

type SupportingFact = {
  path: string
  name: string
  value: FactValue
}

type QueryResponse = {
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
   *  single deciding leaf (stops at branch points where multiple
   *  operands contributed equally). Powers headline rendering without
   *  re-walking the full TraceNode tree. */
  decidingPaths?: Record<string, DecidingPath>
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

/**
 * POST /v1/factgraph/:rulesetId/query
 *
 * Evaluate one or more fact-graph nodes against partial input. Returns the
 * computed values for every resolvable target plus, when anything's still
 * missing, the writables the caller would have to supply to finish.
 *
 * Targets can be any path in the graph — top-level outputs (`/eligible`,
 * `/snap`), intermediate gates (`/grossIncomeLimit`, `/meetsAssetTest`),
 * or per-member facts (e.g. `/members/.../isEligibleMember`, where the
 * middle segment is the wildcard for collection-scoped facts). The same
 * shape applies to all of them.
 *
 * Missing-inputs detection runs the engine with whatever was provided,
 * then walks the dependency graph of each unresolved target. Subtrees
 * whose root already resolved are pruned. Unprovided collections are
 * propagated backward through the reverse-dependency graph so the
 * executor's "0 members" defaults don't silently suppress required
 * member-level fields. See `collectMissingInputs` and
 * `clearUnprovidedCollectionSubtrees`.
 */
router.post('/:rulesetId/query', (req, res) => {
  const rulesetId = req.params.rulesetId
  const model = getRuleset(rulesetId)
  if (!model) {
    res.status(404).json({
      type: 'https://tools.ietf.org/html/rfc9457',
      title: 'Ruleset not found',
      status: 404,
      detail: `No ruleset with id "${rulesetId}" is loaded.`,
    })
    return
  }

  const facts = getRawFacts(rulesetId)
  if (!facts) {
    res.status(500).json({
      type: 'https://tools.ietf.org/html/rfc9457',
      title: 'Ruleset not executable',
      status: 500,
      detail: `Ruleset "${rulesetId}" is loaded but has no raw facts available.`,
    })
    return
  }

  const parsed = QueryRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({
      type: 'https://tools.ietf.org/html/rfc9457',
      title: 'Invalid request body',
      status: 400,
      detail: formatZodIssues(parsed.error.issues),
      errors: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    })
    return
  }
  const body: QueryRequest = parsed.data
  const targets = body.targets

  // Every requested target must exist in the ruleset. Surface the bad
  // ones in detail so the caller can fix the typo without a second
  // round-trip.
  const unknownTargets = targets.filter((t) => !findNodeByPath(model, t))
  if (unknownTargets.length > 0) {
    const joined = unknownTargets.join(', ')
    res.status(404).json({
      type: 'https://tools.ietf.org/html/rfc9457',
      title: 'Target not found',
      status: 404,
      detail: `These targets do not exist in ruleset "${rulesetId}": ${joined}`,
    })
    return
  }

  // The wire shape uses a single unified `inputs` map keyed by path.
  // The executor still wants scalars and collections separated, so we
  // split here at the API boundary.
  const { scalars, collections } = splitInputs(body.inputs)
  const includeSet = new Set(body.include ?? [])
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

  let executionResults: Record<string, unknown>
  try {
    executionResults = executeFactGraph(
      rulesetId,
      facts,
      scalars,
      model.nodes as Record<string, { content: { dataType?: string } }>,
      entitiesForExecutor
    )
  } catch (e) {
    res.status(500).json({
      type: 'https://tools.ietf.org/html/rfc9457',
      title: 'Execution failed',
      status: 500,
      detail: (e as Error).message,
    })
    return
  }

  const effectiveResults = clearUnprovidedCollectionSubtrees(
    model,
    executionResults,
    new Set(Object.keys(entitiesForExecutor))
  )

  // Compose the values map: one entry per requested target. Null if
  // the engine couldn't resolve that target with the provided inputs.
  const values: Record<string, FactValue | null> = {}
  let allResolved = true
  for (const target of targets) {
    const raw = effectiveResults[target]
    if (raw === undefined || raw === null) {
      values[target] = null
      allResolved = false
    } else {
      values[target] = shapeFactValue(target, raw, memberIdsByCollection)
    }
  }

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

  if (body.metadata !== undefined) {
    response.metadata = body.metadata
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
      const t = buildTrace(model, index, effectiveResults, target)
      if (t) {
        traces[target] = t
        decidingPaths[target] = buildDecidingPath(t)
      }
    }
    response.traces = traces
    response.decidingPaths = decidingPaths
  }

  if (!allResolved) {
    // Union of missing inputs across every unresolved target. We dedupe
    // by path because the same writable may surface as needed for
    // multiple targets and the UI only needs one prompt per field.
    const allMissing = new Map<string, MissingInput>()
    for (const target of targets) {
      if (values[target] !== null) continue
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
  }

  res.json(response)
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render a Zod ZodIssue[] as a single human-readable RFC 9457 `detail`
 * string. The structured form is also surfaced via the `errors` field
 * on the error response so machine consumers can branch on field paths.
 */
function formatZodIssues(issues: z.ZodIssue[]): string {
  if (issues.length === 0) return 'Invalid request body.'
  return issues
    .map((i) => {
      const path = i.path.length > 0 ? i.path.join('.') : '(root)'
      return `${path}: ${i.message}`
    })
    .join('; ')
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
 * deleting every visited path. O(nodes + edges) per request; runs once
 * per `/query` call.
 */
function clearUnprovidedCollectionSubtrees(
  model: Model,
  results: Record<string, unknown>,
  providedCollectionPaths: Set<string>
): Record<string, unknown> {
  const index = getModelIndex(model)

  // Roots the caller didn't fill in. If they filled them all (or the
  // ruleset has none), nothing to clear.
  const unprovidedRoots: string[] = []
  for (const root of index.collectionRoots) {
    if (!providedCollectionPaths.has(root)) unprovidedRoots.push(root)
  }
  if (unprovidedRoots.length === 0) return results

  // Seed set: every node under an unprovided root. Pre-grouped on the
  // index so we just concat the relevant buckets — no full re-scan.
  const seeds: ModelNode[] = []
  for (const root of unprovidedRoots) {
    const bucket = index.collectionRootSeeds.get(root)
    if (bucket) seeds.push(...bucket)
  }

  // BFS outward through the cached reverse-dependency graph, deleting
  // each visited path from the working results copy.
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
 * Whether an execution-results value counts as "this fact resolved."
 *
 * Scalars: any defined, non-null value is resolved.
 * Collection-item arrays: resolved only when every element has a value —
 * a partially-populated collection means at least one member is still
 * missing input, and the underlying writable should remain in the
 * missing list.
 */
function hasResolvedValue(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (Array.isArray(value)) {
    if (value.length === 0) return false
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

export default router
