import { Router } from 'express'
import { getRuleset } from '../store.js'
import { autoConfigFromModel } from '../simulation/generator.js'
import { runSimulation } from '../simulation/runner.js'
import {
  saveSimulationRun,
  listSimulationRuns,
  getSimulationRun,
  loadCaseResults,
  deleteSimulationRun,
  setActiveRun,
  getActiveRun,
  clearActiveRun,
} from '../simulation/store.js'
import type { SimulationConfig, SimulationRun } from '../simulation/types.js'

const router = Router()

/**
 * POST /api/rulesets/:id/simulations/configure
 * Auto-generate a SimulationConfig from the model's writable inputs.
 */
router.post('/rulesets/:id/simulations/configure', (req, res) => {
  const model = getRuleset(req.params.id)
  if (!model) {
    res.status(404).json({ error: 'Ruleset not found' })
    return
  }

  const overrides = req.body ?? {}
  const config = autoConfigFromModel(model, overrides)
  res.json(config)
})

/**
 * POST /api/rulesets/:id/simulations/run
 * Execute a simulation run. Synchronous — may take 10-30 seconds.
 */
router.post('/rulesets/:id/simulations/run', (req, res) => {
  const rulesetId = req.params.id
  const model = getRuleset(rulesetId)
  if (!model) {
    res.status(404).json({ error: 'Ruleset not found' })
    return
  }

  const { config, comparedRulesetId } = req.body as {
    config: SimulationConfig
    comparedRulesetId: string
  }

  if (!config || !comparedRulesetId) {
    res.status(400).json({ error: 'config and comparedRulesetId are required' })
    return
  }

  if (!getRuleset(comparedRulesetId)) {
    res.status(404).json({
      error: `Compared ruleset "${comparedRulesetId}" not found`,
    })
    return
  }

  // Create a placeholder run and return immediately
  const pendingRun: SimulationRun = {
    id: config.id,
    rulesetId,
    comparedRulesetId,
    config,
    status: 'running',
    progress: { completed: 0, total: config.caseCount },
    startedAt: new Date().toISOString(),
  }
  setActiveRun(pendingRun)
  res.json(pendingRun)

  // Run in the background — the async runner yields the event loop
  // periodically so Express can handle poll requests for progress.
  runSimulation(rulesetId, comparedRulesetId, config, (completed, total) => {
    const active = getActiveRun(config.id)
    if (active) active.progress = { completed, total }
  })
    .then(({ run, results }) => {
      saveSimulationRun(run, results)
      clearActiveRun(config.id)
    })
    .catch((e) => {
      const active = getActiveRun(config.id)
      if (active) {
        active.status = 'failed'
        active.error = (e as Error).message
      }
    })
})

/**
 * GET /api/rulesets/:id/simulations
 * List all simulation runs for a ruleset.
 */
router.get('/rulesets/:id/simulations', (req, res) => {
  const model = getRuleset(req.params.id)
  if (!model) {
    res.status(404).json({ error: 'Ruleset not found' })
    return
  }
  res.json(listSimulationRuns(req.params.id))
})

/**
 * GET /api/rulesets/:id/simulations/:runId
 * Get a single simulation run with summary.
 */
router.get('/rulesets/:id/simulations/:runId', (req, res) => {
  // Check active (running) simulations first for live progress
  const active = getActiveRun(req.params.runId)
  if (active) {
    res.json(active)
    return
  }
  const run = getSimulationRun(req.params.id, req.params.runId)
  if (!run) {
    res.status(404).json({ error: 'Simulation run not found' })
    return
  }
  res.json(run)
})

/**
 * GET /api/rulesets/:id/simulations/:runId/results
 * Paginated case results with optional filter.
 */
router.get('/rulesets/:id/simulations/:runId/results', (req, res) => {
  const run = getSimulationRun(req.params.id, req.params.runId)
  if (!run) {
    res.status(404).json({ error: 'Simulation run not found' })
    return
  }

  const offset = parseInt(req.query.offset as string) || 0
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 500)
  const filter = (req.query.filter as string) || 'all'

  if (!['all', 'changed', 'unchanged'].includes(filter)) {
    res.status(400).json({ error: 'filter must be all, changed, or unchanged' })
    return
  }

  res.json(
    loadCaseResults(
      req.params.id,
      req.params.runId,
      offset,
      limit,
      filter as 'all' | 'changed' | 'unchanged'
    )
  )
})

/**
 * DELETE /api/rulesets/:id/simulations/:runId
 * Delete a simulation run.
 */
router.delete('/rulesets/:id/simulations/:runId', (req, res) => {
  const deleted = deleteSimulationRun(req.params.id, req.params.runId)
  if (!deleted) {
    res.status(404).json({ error: 'Simulation run not found' })
    return
  }
  res.json({ success: true })
})

export default router
