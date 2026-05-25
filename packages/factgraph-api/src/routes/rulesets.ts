import { Router } from 'express'
import { listRulesets, getRuleset } from 'rules-visualizer-factgraph-core'

const router = Router()

/**
 * GET /v1/factgraph/rulesets
 *
 * List every ruleset currently loaded by the server. Returns the
 * stable identifier (used in subsequent URLs), display name, and
 * format tag. Partner UIs use this to populate ruleset pickers and
 * to confirm a known ID exists before issuing queries.
 */
router.get('/rulesets', (_req, res) => {
  res.json({ rulesets: listRulesets() })
})

/**
 * GET /v1/factgraph/:rulesetId/schema
 *
 * Return the full node index for a ruleset: every fact's path, name,
 * description, data type, and (where present) policy citations. This
 * is the source of truth for which inputs exist, which outputs are
 * queryable, and what each field means.
 *
 * Stable across reloads only insofar as the rules don't change — when
 * we ship a new ruleset version (e.g. FY2025 → FY2026), node paths
 * may rename. Partners pinning specific fields should refer to
 * documented public outputs (eligible, snap, expedited) rather than
 * relying on every internal path being stable.
 */
router.get('/:rulesetId/schema', (req, res) => {
  const model = getRuleset(req.params.rulesetId)
  if (!model) {
    res.status(404).json({
      type: 'https://tools.ietf.org/html/rfc9457',
      title: 'Ruleset not found',
      status: 404,
      detail: `No ruleset with id "${req.params.rulesetId}" is loaded.`,
    })
    return
  }
  res.json({
    id: model.id,
    name: model.name,
    format: model.format,
    nodes: model.nodes,
  })
})

export default router
