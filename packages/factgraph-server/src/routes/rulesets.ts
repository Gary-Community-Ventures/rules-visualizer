import { Router } from 'express'
import { listRulesets, getRuleset, getRawFacts } from '../store.js'
import { executeFactGraph } from '../executor.js'

const router = Router()

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

  try {
    const pathResults = executeFactGraph(rulesetId, facts, inputs, model.nodes as Record<string, { content: { dataType?: string } }>)

    // Map path results to node IDs
    const pathToNodeId: Record<string, string> = {}
    for (const [nodeId, node] of Object.entries(model.nodes)) {
      const path = node.content.type === 'entity' ? undefined : node.content.path
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

export default router
