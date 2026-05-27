import { Router } from 'express'
import {
  getRuleset,
  cacheStats,
  timings,
} from 'rules-visualizer-factgraph-core'
import {
  autoConfigFromModel,
  loadSimulationDefaults,
  mergeSimulationConfig,
} from '../simulation/generator.js'
import { runSimulation, lastParallelTimings } from '../simulation/runner.js'
import {
  saveSimulationRun,
  listSimulationRuns,
  getSimulationRun,
  loadCaseResults,
  loadCasesFromRun,
  updateSimulationRunMetadata,
  deleteSimulationRun,
  setActiveRun,
  getActiveRun,
  clearActiveRun,
} from '../simulation/store.js'
import {
  listPopulations,
  getPopulation,
  createPopulation,
  addCasesToPopulation,
  removeCaseFromPopulation,
  updatePopulation,
  updateCaseInPopulation,
  deletePopulation,
  populationCasesToScenarios,
  type PopulationCase,
} from '../simulation/populations.js'
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

  const defaults = loadSimulationDefaults(req.params.id)
  const overrides = req.body ?? {}
  const config = mergeSimulationConfig(
    autoConfigFromModel(model),
    defaults,
    overrides
  )
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

  const {
    config,
    comparedRulesetId,
    populationId,
    baseOverrides,
    comparedOverrides,
  } = req.body as {
    config: SimulationConfig
    comparedRulesetId: string
    populationId?: string
    baseOverrides?: Record<string, unknown>
    comparedOverrides?: Record<string, unknown>
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

  // If a population is specified, load its cases as prebuilt scenarios
  let prebuiltScenarios:
    | ReturnType<typeof populationCasesToScenarios>
    | undefined
  let populationName: string | undefined
  if (populationId) {
    const population = getPopulation(populationId)
    if (!population) {
      res.status(404).json({ error: `Population "${populationId}" not found` })
      return
    }
    prebuiltScenarios = populationCasesToScenarios(population.cases)
    populationName = population.name
  }

  const totalCases = prebuiltScenarios?.length ?? config.caseCount

  // Create a placeholder run and return immediately
  const pendingRun: SimulationRun = {
    id: config.id,
    rulesetId,
    comparedRulesetId,
    config,
    status: 'running',
    progress: { completed: 0, total: totalCases },
    populationId,
    populationName,
    baseOverrides,
    comparedOverrides,
    startedAt: new Date().toISOString(),
  }
  setActiveRun(pendingRun)
  res.json(pendingRun)

  // Run in the background — the async runner yields the event loop
  // periodically so Express can handle poll requests for progress.
  runSimulation(
    rulesetId,
    comparedRulesetId,
    config,
    (completed, total) => {
      const active = getActiveRun(config.id)
      if (active) active.progress = { completed, total }
    },
    prebuiltScenarios,
    baseOverrides,
    comparedOverrides
  )
    .then(({ run, results }) => {
      run.populationId = populationId
      run.populationName = populationName
      run.baseOverrides = baseOverrides
      run.comparedOverrides = comparedOverrides
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
 * PATCH /api/rulesets/:id/simulations/:runId
 * Update run metadata (currently just `name`).
 */
router.patch('/rulesets/:id/simulations/:runId', (req, res) => {
  const { name } = req.body as { name?: string | null }
  const updated = updateSimulationRunMetadata(req.params.id, req.params.runId, {
    name: name ?? undefined,
  })
  if (!updated) {
    res.status(404).json({ error: 'Simulation run not found' })
    return
  }
  res.json(updated)
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

/** GET /api/simulations/cache-stats — debug: dictionary cache hit/miss counts. */
router.get('/simulations/cache-stats', (_req, res) => {
  const avg = (count: number, n: number) =>
    count === 0 ? 0 : Math.round((n / count) * 1000) / 1000
  // Inline executes mutate factgraph-core's `timings` directly. Parallel
  // executes run in worker threads with their own heaps, so the runner
  // sums their reported timings into `lastParallelTimings` at end-of-run.
  // We surface both: callers profiling a parallel sim should look at
  // `parallel`; inline runs (e.g. tiny test sims) show up in `inline`.
  res.json({
    cache: cacheStats,
    inline: {
      raw: timings,
      avgMs: {
        dict: avg(timings.count, timings.dict),
        graphInit: avg(timings.count, timings.graphInit),
        collections: avg(timings.count, timings.collections),
        scalarInputs: avg(timings.count, timings.scalarInputs),
        read: avg(timings.count, timings.read),
        total: avg(timings.count, timings.total),
      },
    },
    parallel: {
      raw: lastParallelTimings,
      avgMs: {
        dict: avg(lastParallelTimings.count, lastParallelTimings.dict),
        graphInit: avg(
          lastParallelTimings.count,
          lastParallelTimings.graphInit
        ),
        collections: avg(
          lastParallelTimings.count,
          lastParallelTimings.collections
        ),
        scalarInputs: avg(
          lastParallelTimings.count,
          lastParallelTimings.scalarInputs
        ),
        read: avg(lastParallelTimings.count, lastParallelTimings.read),
        total: avg(lastParallelTimings.count, lastParallelTimings.total),
      },
    },
    // Back-compat shim — older clients read `.timings`. Same as inline.
    timings: {
      raw: timings,
      avgMs: {
        dict: avg(timings.count, timings.dict),
        graphInit: avg(timings.count, timings.graphInit),
        collections: avg(timings.count, timings.collections),
        scalarInputs: avg(timings.count, timings.scalarInputs),
        read: avg(timings.count, timings.read),
        total: avg(timings.count, timings.total),
      },
    },
  })
})

/** POST /api/simulations/cache-stats/reset — debug: zero counters. */
router.post('/simulations/cache-stats/reset', (_req, res) => {
  cacheStats.hits = 0
  cacheStats.misses = 0
  timings.dict = 0
  timings.graphInit = 0
  timings.collections = 0
  timings.scalarInputs = 0
  timings.read = 0
  timings.total = 0
  timings.count = 0
  res.json({ ok: true })
})

// --- Population endpoints (shared across rulesets) ---

/** GET /api/populations — list all populations. */
router.get('/populations', (_req, res) => {
  res.json(listPopulations())
})

/** GET /api/populations/:id — get a single population. */
router.get('/populations/:id', (req, res) => {
  const pop = getPopulation(req.params.id)
  if (!pop) {
    res.status(404).json({ error: 'Population not found' })
    return
  }
  res.json(pop)
})

type FromRunSpec = {
  rulesetId: string
  runId: string
  filter?: 'all' | 'changed' | 'unchanged'
  scenarioIds?: number[]
}

function resolveCasesFromBody(body: {
  cases?: PopulationCase[]
  fromRun?: FromRunSpec
}): { cases?: PopulationCase[]; error?: string } {
  if (Array.isArray(body.cases)) return { cases: body.cases }
  if (body.fromRun) {
    const { rulesetId, runId, filter, scenarioIds } = body.fromRun
    if (!rulesetId || !runId)
      return { error: 'fromRun.rulesetId and fromRun.runId are required' }
    if (!getSimulationRun(rulesetId, runId))
      return { error: `Simulation run "${runId}" not found` }
    const cases = loadCasesFromRun(rulesetId, runId, { filter, scenarioIds })
    return { cases }
  }
  return { error: 'cases[] or fromRun is required' }
}

/** POST /api/populations — create a new population. */
router.post('/populations', (req, res) => {
  const { name, description } = req.body as {
    name: string
    description?: string
  }
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  const { cases, error } = resolveCasesFromBody(req.body)
  if (error) {
    res.status(400).json({ error })
    return
  }
  try {
    const pop = createPopulation(name, cases ?? [], description)
    res.json(pop)
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

/** POST /api/populations/:id/cases — add cases to a population. */
router.post('/populations/:id/cases', (req, res) => {
  const { cases, error } = resolveCasesFromBody(req.body)
  if (error) {
    res.status(400).json({ error })
    return
  }
  const pop = addCasesToPopulation(req.params.id, cases ?? [])
  if (!pop) {
    res.status(404).json({ error: 'Population not found' })
    return
  }
  res.json(pop)
})

/** PATCH /api/populations/:id — update name, description, or default ruleset. */
router.patch('/populations/:id', (req, res) => {
  const { name, description, defaultRulesetId } = req.body as {
    name?: string
    description?: string | null
    defaultRulesetId?: string | null
  }
  const updated = updatePopulation(req.params.id, {
    name,
    description: description === null ? '' : description,
    defaultRulesetId: defaultRulesetId === null ? '' : defaultRulesetId,
  })
  if (!updated) {
    res.status(404).json({ error: 'Population not found' })
    return
  }
  res.json(updated)
})

/** PATCH /api/populations/:id/cases/:caseId — update a case in place. */
router.patch('/populations/:id/cases/:caseId', (req, res) => {
  const caseId = parseInt(req.params.caseId)
  if (isNaN(caseId)) {
    res.status(400).json({ error: 'Invalid case ID' })
    return
  }
  const { name, inputs, entities } = req.body as {
    name?: string
    inputs?: Record<string, unknown>
    entities?: Record<string, Record<string, unknown>[]>
  }
  const updated = updateCaseInPopulation(req.params.id, caseId, {
    name,
    inputs,
    entities,
  })
  if (!updated) {
    res.status(404).json({ error: 'Population or case not found' })
    return
  }
  res.json(updated)
})

/** DELETE /api/populations/:id/cases/:caseId — remove a case. */
router.delete('/populations/:id/cases/:caseId', (req, res) => {
  const caseId = parseInt(req.params.caseId)
  if (isNaN(caseId)) {
    res.status(400).json({ error: 'Invalid case ID' })
    return
  }
  const pop = removeCaseFromPopulation(req.params.id, caseId)
  if (!pop) {
    res.status(404).json({ error: 'Population not found' })
    return
  }
  res.json(pop)
})

/** DELETE /api/populations/:id — delete a population. */
router.delete('/populations/:id', (req, res) => {
  if (!deletePopulation(req.params.id)) {
    res.status(404).json({ error: 'Population not found' })
    return
  }
  res.json({ success: true })
})

export default router
