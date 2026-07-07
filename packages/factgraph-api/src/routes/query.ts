import { Router } from 'express'
import { z } from 'zod'
import { getRuleset, getRawFacts } from 'rules-visualizer-factgraph-core'

import { runQuery } from '../evaluate.js'

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

    /** Opt-in response sections. Today: `"supportingFacts"`, `"trace"`,
     *  and the experimental `"missingInputInstances"` (per-instance
     *  missing-inputs with hop-chain addresses). Unknown values are
     *  ignored. */
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
 * The execution, missing-inputs walk, and trace building live in
 * `../evaluate.ts` (`runQuery`), shared with the eligibility adapter
 * routes. This handler is the HTTP boundary: validate the body, resolve
 * the ruleset, map the result onto status codes.
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

  let result
  try {
    result = runQuery(rulesetId, model, facts, {
      targets: body.targets,
      inputs: body.inputs,
      include: body.include,
      metadata: body.metadata,
    })
  } catch (e) {
    res.status(500).json({
      type: 'https://tools.ietf.org/html/rfc9457',
      title: 'Execution failed',
      status: 500,
      detail: (e as Error).message,
    })
    return
  }

  // A bad target in a caller-supplied /query body is a 404 — surface every
  // offending path so the caller can fix typos without a second round-trip.
  if (!result.ok) {
    const joined = result.unknownTargets.join(', ')
    res.status(404).json({
      type: 'https://tools.ietf.org/html/rfc9457',
      title: 'Target not found',
      status: 404,
      detail: `These targets do not exist in ruleset "${rulesetId}": ${joined}`,
    })
    return
  }

  res.json(result.response)
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

export default router
