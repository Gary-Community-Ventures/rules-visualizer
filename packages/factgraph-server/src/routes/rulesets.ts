import { Router } from 'express'
import { listRulesets, getRuleset, getRawFacts } from '../store.js'
import { executeFactGraph } from '../executor.js'

const router = Router()

// Cache the "empty-inputs" execution per (rulesetId, facts array identity).
// The facts array reference changes on file-watcher reloads so this entry
// becomes unreachable and gets GC'd, giving us automatic invalidation.
type DefaultValuesCacheEntry = {
  facts: object
  values: Record<string, unknown>
}
const defaultValuesCache = new Map<string, DefaultValuesCacheEntry>()

router.get('/rulesets', (_req, res) => {
  res.json({ rulesets: listRulesets() })
})

router.get('/rulesets/:id', (req, res) => {
  const model = getRuleset(req.params.id)
  if (!model) {
    res.status(404).json({ error: 'Ruleset not found' })
    return
  }
  res.json(model)
})

router.post('/rulesets/:id/execute', (req, res) => {
  const rulesetId = req.params.id
  const model = getRuleset(rulesetId)
  if (!model) {
    res.status(404).json({ error: 'Ruleset not found' })
    return
  }

  const facts = getRawFacts(rulesetId)
  if (!facts) {
    res.status(400).json({ error: 'No raw facts available for execution' })
    return
  }

  const inputs: Record<string, unknown> = req.body?.inputs ?? {}
  const entities: Record<string, Record<string, unknown>[]> =
    req.body?.entities ?? {}

  try {
    const pathResults = executeFactGraph(
      rulesetId,
      facts,
      inputs,
      model.nodes as Record<string, { content: { dataType?: string } }>,
      entities
    )

    // Map path results to node IDs
    const pathToNodeId: Record<string, string> = {}
    for (const [nodeId, node] of Object.entries(model.nodes)) {
      const path =
        node.content.type === 'entity' ? undefined : node.content.path
      if (path) pathToNodeId[path] = nodeId
    }

    const results: Record<string, { value: unknown }> = {}
    for (const [path, value] of Object.entries(pathResults)) {
      const nodeId = pathToNodeId[path]
      if (nodeId) {
        results[nodeId] = { value }
      }
    }

    res.json({ results })
  } catch (e) {
    res.status(500).json({
      error: `Execution failed: ${(e as Error).message}`,
    })
  }
})

/**
 * GET /api/rulesets/:id/default-values
 * Execute the graph with empty inputs and return the resulting value map.
 * Lets the FE show "current: X" hints when constructing overrides so the
 * user knows what they're changing from. Cached per (rulesetId, facts).
 */
router.get('/rulesets/:id/default-values', (req, res) => {
  const rulesetId = req.params.id
  const model = getRuleset(rulesetId)
  if (!model) {
    res.status(404).json({ error: 'Ruleset not found' })
    return
  }
  const facts = getRawFacts(rulesetId)
  if (!facts) {
    res.status(400).json({ error: 'No raw facts available' })
    return
  }

  const cached = defaultValuesCache.get(rulesetId)
  if (cached && cached.facts === facts) {
    res.json({ values: cached.values })
    return
  }

  try {
    const values = executeFactGraph(
      rulesetId,
      facts,
      {},
      model.nodes as Record<string, { content: { dataType?: string } }>,
      {}
    )
    defaultValuesCache.set(rulesetId, { facts, values })
    res.json({ values })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

export default router
