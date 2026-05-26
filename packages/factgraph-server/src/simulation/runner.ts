/**
 * Simulation runner — executes scenarios against two ruleset versions and
 * compares results.
 */

import os from 'node:os'
import { Worker } from 'node:worker_threads'
import {
  getRuleset,
  getRawFacts,
  executeFactGraph,
} from 'rules-visualizer-factgraph-core'
import { compareValues } from '../testStore.js'
import { generateScenarios } from './generator.js'
import type {
  SimulationConfig,
  SimulationRun,
  SimulationSummary,
  CaseResult,
  CaseDiff,
  NodeChangeStats,
  GeneratedScenario,
} from './types.js'

// Worker pool size. Cap at 8 because the Scala.js bundle is ~6MB per
// worker and we get diminishing returns past 8 cores once memory pressure
// kicks in. Env override mainly useful for benchmarking / disabling
// parallelism (SIMULATION_WORKERS=1 falls back to inline execution).
const DEFAULT_MAX_WORKERS = 8
const WORKER_COUNT = Math.max(
  1,
  Math.min(
    Number(process.env.SIMULATION_WORKERS) ||
      os.availableParallelism?.() ||
      os.cpus().length,
    DEFAULT_MAX_WORKERS
  )
)
// Worker spawn + Scala.js bundle load is ~1-2s; for tiny runs that
// dominates wall-clock. Stay inline below this threshold.
const PARALLEL_THRESHOLD = 100

/**
 * Diff the results from two executions. Returns outcome-only diffs and all diffs.
 */
function diffResults(
  base: Record<string, unknown>,
  edited: Record<string, unknown>,
  outcomeNodes: Set<string>
): { outcomeDiffs: CaseDiff[]; allDiffs: CaseDiff[] } {
  const allDiffs: CaseDiff[] = []
  const outcomeDiffs: CaseDiff[] = []
  const allPaths = new Set([...Object.keys(base), ...Object.keys(edited)])

  for (const path of allPaths) {
    const bv = base[path]
    const ev = edited[path]

    let diff: CaseDiff | null = null

    if (!(path in base)) {
      diff = {
        path,
        baseValue: undefined,
        editedValue: ev,
        changeType: 'added',
      }
    } else if (!(path in edited)) {
      diff = {
        path,
        baseValue: bv,
        editedValue: undefined,
        changeType: 'removed',
      }
    } else if (!compareValues(bv, ev)) {
      diff = { path, baseValue: bv, editedValue: ev, changeType: 'changed' }
    }

    if (diff) {
      allDiffs.push(diff)
      if (outcomeNodes.has(path)) {
        outcomeDiffs.push(diff)
      }
    }
  }

  return { outcomeDiffs, allDiffs }
}

/**
 * Compute aggregate statistics from all case results.
 */
function computeSummary(
  results: CaseResult[],
  executionTimeMs: number
): SimulationSummary {
  let changedCases = 0
  let errorCases = 0
  const nodeStats = new Map<
    string,
    {
      timesChanged: number
      timesIncreased: number
      timesDecreased: number
      totalDelta: number
      numericCount: number
    }
  >()

  for (const r of results) {
    if (r.error) {
      errorCases++
      continue
    }
    if (r.changed) changedCases++

    for (const diff of r.allDiffs) {
      let stats = nodeStats.get(diff.path)
      if (!stats) {
        stats = {
          timesChanged: 0,
          timesIncreased: 0,
          timesDecreased: 0,
          totalDelta: 0,
          numericCount: 0,
        }
        nodeStats.set(diff.path, stats)
      }
      stats.timesChanged++

      if (
        typeof diff.baseValue === 'number' &&
        typeof diff.editedValue === 'number'
      ) {
        const delta = diff.editedValue - diff.baseValue
        if (delta > 0) stats.timesIncreased++
        else if (delta < 0) stats.timesDecreased++
        stats.totalDelta += delta
        stats.numericCount++
      }
    }
  }

  const nodeChanges: NodeChangeStats[] = Array.from(nodeStats.entries())
    .map(([path, stats]) => ({
      path,
      timesChanged: stats.timesChanged,
      timesIncreased: stats.timesIncreased,
      timesDecreased: stats.timesDecreased,
      avgDelta:
        stats.numericCount > 0
          ? Math.round((stats.totalDelta / stats.numericCount) * 100) / 100
          : undefined,
    }))
    .sort((a, b) => b.timesChanged - a.timesChanged)

  return {
    totalCases: results.length,
    changedCases,
    unchangedCases: results.length - changedCases - errorCases,
    errorCases,
    nodeChanges,
    executionTimeMs,
  }
}

/** Yield the event loop so Express can handle incoming requests. */
function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * Resolve how to spawn the worker. There's an asymmetry between dev and
 * prod that bites us: under `tsx watch` we want the worker to run the
 * .ts source (because there's no compiled .js on disk), but Node's
 * `new Worker(fileUrl)` opens the file directly with no module-resolver
 * involvement — so tsx's loader never gets a chance to transform .ts.
 * Workaround: in dev, spawn an inline ESM shim via `eval: true` that
 * calls `tsImport` to load the .ts worker through tsx's API. In prod
 * (after `tsc` compile) the .js exists on disk and we hand back a plain
 * file URL.
 */
function workerSpawnArgs(): {
  source: string | URL
  options: { eval?: boolean }
} {
  const here = import.meta.url
  const isDev = here.endsWith('.ts')
  if (!isDev) {
    return {
      source: new URL(here.replace(/runner\.js$/, 'worker.js')),
      options: {},
    }
  }
  const workerUrl = here.replace(/runner\.ts$/, 'worker.ts')
  // `tsImport(specifier, parent)` runs `specifier` through tsx's loader,
  // resolving .ts and yielding an ESM module. Awaiting it as the worker
  // entry means the worker's lifetime tracks the import's promise.
  const shim = `
import { tsImport } from 'tsx/esm/api'
await tsImport(${JSON.stringify(workerUrl)}, ${JSON.stringify(here)})
`
  return { source: shim, options: { eval: true } }
}

type WorkerProgressMsg = { type: 'progress'; count: number }
type WorkerDoneMsg = { type: 'done'; results: CaseResult[] }
type WorkerMsg = WorkerProgressMsg | WorkerDoneMsg

/**
 * Fan a scenario list out across N worker threads. Each worker gets a
 * contiguous slice; results are merged back in chunk order so the final
 * array matches scenario order (case-detail navigation relies on that).
 */
async function runParallel(
  baseRulesetId: string,
  comparedRulesetId: string,
  baseFacts: ReturnType<typeof getRawFacts>,
  comparedFacts: ReturnType<typeof getRawFacts>,
  baseModelNodes: Record<string, { content: { dataType?: string } }>,
  comparedModelNodes: Record<string, { content: { dataType?: string } }>,
  scenarios: GeneratedScenario[],
  outcomeNodes: string[],
  baseOverrides: Record<string, unknown> | undefined,
  comparedOverrides: Record<string, unknown> | undefined,
  onProgress?: (completed: number, total: number) => void
): Promise<CaseResult[]> {
  const workerCount = Math.min(WORKER_COUNT, scenarios.length)
  const chunkSize = Math.ceil(scenarios.length / workerCount)
  const chunks: GeneratedScenario[][] = []
  for (let i = 0; i < workerCount; i++) {
    const slice = scenarios.slice(i * chunkSize, (i + 1) * chunkSize)
    if (slice.length > 0) chunks.push(slice)
  }

  const total = scenarios.length
  // Each worker reports a count *within its slice*; we keep per-worker
  // counters and report the sum so the UI sees monotonic progress.
  const perWorkerCompleted = chunks.map(() => 0)
  // Throttle progress emission to avoid spamming the active-runs map.
  const PROGRESS_REPORT_EVERY = 50

  const { source, options } = workerSpawnArgs()

  const chunkResults: CaseResult[][] = await Promise.all(
    chunks.map(
      (chunk, idx) =>
        new Promise<CaseResult[]>((resolve, reject) => {
          const worker = new Worker(source as never, {
            ...options,
            workerData: {
              baseRulesetId,
              comparedRulesetId,
              baseFacts,
              comparedFacts,
              baseModelNodes,
              comparedModelNodes,
              scenarios: chunk,
              outcomeNodes,
              baseOverrides,
              comparedOverrides,
              progressInterval: PROGRESS_REPORT_EVERY,
            },
          })
          worker.on('message', (msg: WorkerMsg) => {
            if (msg.type === 'progress') {
              perWorkerCompleted[idx] = msg.count
              if (onProgress) {
                const sum = perWorkerCompleted.reduce((a, b) => a + b, 0)
                onProgress(sum, total)
              }
            } else if (msg.type === 'done') {
              perWorkerCompleted[idx] = chunk.length
              if (onProgress) {
                const sum = perWorkerCompleted.reduce((a, b) => a + b, 0)
                onProgress(sum, total)
              }
              resolve(msg.results)
              worker.terminate()
            }
          })
          worker.on('error', reject)
          worker.on('exit', (code) => {
            if (code !== 0) {
              reject(new Error(`Worker exited with code ${code}`))
            }
          })
        })
    )
  )

  return chunkResults.flat()
}

/**
 * Run a full simulation: generate or use provided scenarios, execute both
 * versions, diff, summarize.
 *
 * @param prebuiltScenarios - If provided, uses these instead of generating
 *   random scenarios. Used for saved population cases.
 * @param baseOverrides / comparedOverrides - Path → value pairs merged into
 *   every scenario's inputs before execution on that side. Lets you compare
 *   "ruleset A" against "ruleset A with /standardDeduction set to X" without
 *   needing a second ruleset.
 */
export async function runSimulation(
  baseRulesetId: string,
  comparedRulesetId: string,
  config: SimulationConfig,
  onProgress?: (completed: number, total: number) => void,
  prebuiltScenarios?: GeneratedScenario[],
  baseOverrides?: Record<string, unknown>,
  comparedOverrides?: Record<string, unknown>
): Promise<{ run: SimulationRun; results: CaseResult[] }> {
  const startTime = Date.now()

  const baseModel = getRuleset(baseRulesetId)
  const baseFacts = getRawFacts(baseRulesetId)
  const editedModel = getRuleset(comparedRulesetId)
  const editedFacts = getRawFacts(comparedRulesetId)

  if (!baseModel || !baseFacts) {
    throw new Error(`Base ruleset "${baseRulesetId}" not found`)
  }
  if (!editedModel || !editedFacts) {
    throw new Error(`Compared ruleset "${comparedRulesetId}" not found`)
  }

  // Use prebuilt scenarios (saved population) or generate random ones
  const scenarios = prebuiltScenarios ?? generateScenarios(config)
  const outcomeSet = new Set(config.outcomeNodes)

  const hasBaseOverrides =
    baseOverrides && Object.keys(baseOverrides).length > 0
  const hasComparedOverrides =
    comparedOverrides && Object.keys(comparedOverrides).length > 0

  // Parallel path: hand the whole scenario list off to a worker pool.
  // Skipped for tiny runs (spawn overhead dominates) and when the user
  // pinned worker count to 1 for benchmarking.
  if (WORKER_COUNT > 1 && scenarios.length >= PARALLEL_THRESHOLD) {
    const results = await runParallel(
      baseRulesetId,
      comparedRulesetId,
      baseFacts,
      editedFacts,
      baseModel.nodes as Record<string, { content: { dataType?: string } }>,
      editedModel.nodes as Record<string, { content: { dataType?: string } }>,
      scenarios,
      config.outcomeNodes,
      baseOverrides,
      comparedOverrides,
      onProgress
    )
    const executionTimeMs = Date.now() - startTime
    const summary = computeSummary(results, executionTimeMs)
    return {
      run: {
        id: config.id,
        rulesetId: baseRulesetId,
        comparedRulesetId,
        config,
        status: 'completed',
        summary,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      },
      results,
    }
  }

  // Inline path: execute in the main thread. Used for small runs and
  // when the worker pool is disabled.
  // Narrow the engine's read pass to outcomes (see worker.ts for rationale).
  const readPaths = outcomeSet
  const results: CaseResult[] = []
  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i]
    try {
      const baseInputs = hasBaseOverrides
        ? { ...scenario.inputs, ...baseOverrides }
        : scenario.inputs
      const comparedInputs = hasComparedOverrides
        ? { ...scenario.inputs, ...comparedOverrides }
        : scenario.inputs

      const baseResults = executeFactGraph(
        baseRulesetId,
        baseFacts,
        baseInputs,
        baseModel.nodes as Record<string, { content: { dataType?: string } }>,
        scenario.entities,
        readPaths
      )

      const editedResults = executeFactGraph(
        comparedRulesetId,
        editedFacts,
        comparedInputs,
        editedModel.nodes as Record<string, { content: { dataType?: string } }>,
        scenario.entities,
        readPaths
      )

      const { outcomeDiffs, allDiffs } = diffResults(
        baseResults,
        editedResults,
        outcomeSet
      )

      results.push({
        scenarioId: scenario.id,
        inputs: scenario.inputs,
        entities: scenario.entities,
        baseResults,
        editedResults,
        outcomeDiffs,
        allDiffs,
        changed: outcomeDiffs.length > 0,
      })
    } catch (e) {
      results.push({
        scenarioId: scenario.id,
        inputs: scenario.inputs,
        entities: scenario.entities,
        baseResults: {},
        editedResults: {},
        outcomeDiffs: [],
        allDiffs: [],
        changed: false,
        error: (e as Error).message,
      })
    }

    if (i > 0 && i % 50 === 0) {
      if (onProgress) onProgress(i, scenarios.length)
      // Yield the event loop every 50 cases so the server can respond to poll requests
      await yieldEventLoop()
    }
  }

  const executionTimeMs = Date.now() - startTime
  const summary = computeSummary(results, executionTimeMs)

  const run: SimulationRun = {
    id: config.id,
    rulesetId: baseRulesetId,
    comparedRulesetId,
    config,
    status: 'completed',
    summary,
    startedAt: new Date(startTime).toISOString(),
    completedAt: new Date().toISOString(),
  }

  return { run, results }
}
