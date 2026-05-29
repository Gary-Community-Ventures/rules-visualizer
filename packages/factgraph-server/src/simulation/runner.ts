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
 * True when base and compared sides will produce identical results for every
 * scenario — same ruleset and same overrides. Lets the runner skip the
 * second execute (~2× wall time savings for same-vs-same comparisons,
 * which is the common case while iterating on a single ruleset).
 *
 * Overrides are flat path→primitive maps, so stringify-compare is fine and
 * cheaper than a custom deep-equal. `??{}` normalizes undefined and {} to
 * the same string so e.g. (undefined, {}) compares equal.
 */
export function sidesAreIdentical(
  baseRulesetId: string,
  comparedRulesetId: string,
  baseOverrides: Record<string, unknown> | undefined,
  comparedOverrides: Record<string, unknown> | undefined
): boolean {
  if (baseRulesetId !== comparedRulesetId) return false
  const a = JSON.stringify(baseOverrides ?? {}, Object.keys(baseOverrides ?? {}).sort())
  const b = JSON.stringify(comparedOverrides ?? {}, Object.keys(comparedOverrides ?? {}).sort())
  return a === b
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

/** Engine-timing snapshot reported by each worker at end of its slice. */
export type EngineTimingsSnapshot = {
  dict: number
  graphInit: number
  collections: number
  scalarInputs: number
  read: number
  total: number
  count: number
}
type WorkerProgressMsg = { type: 'progress'; count: number }
type WorkerDoneMsg = {
  type: 'done'
  results: CaseResult[]
  timings: EngineTimingsSnapshot
}
type WorkerMsg = WorkerProgressMsg | WorkerDoneMsg

// --- Persistent worker pool ----------------------------------------------
// Workers carry a ~6MB Scala.js bundle (loaded at spawn) plus a JS-side
// dictionary build that runs on first execute. Spawning a fresh pool per
// simulation paid both costs every time. Keeping workers alive amortizes:
// the first sim pays the bundle load + dict build; subsequent sims see
// workers already booted with the bundle resident and (when facts didn't
// change) the dictionary cached.
//
// Measured impact is modest — wall-time win is ~2-3s per sim (4-6%) on
// 1000-case snap-complete because workers spawn in parallel, so the
// pre-pool spawn cost was bounded by the slowest single worker (~2s),
// not the sum across 8. The clearer signal shows in per-execute `dict`
// time: drops from ~2.2ms (cold worker) to ~0.6ms (warm worker reusing
// the cached FactDictionary across sims with the same facts array).
//
// Each worker sits in a message loop in pool mode (see worker.ts). The
// runner sends an `assign` message per chunk, the worker processes it,
// posts `done`, and goes back to waiting. `shutdownWorkerPool` is exposed
// for callers that want to force a fresh pool (e.g., after re-vendoring
// the Scala.js bundle in a dev session). File-watcher ruleset reloads do
// NOT need to kill the pool because facts arrive fresh on each assignment.
//
// Concurrency limitation: this V1 supports only one in-flight simulation
// at a time. If a second `runSimulation` is invoked while another is
// still claiming workers, `runParallel` throws. The UI prevents this
// (Run button is disabled while a sim is running), but API consumers
// firing two sims back-to-back from a script could trip it. A follow-up
// could queue the second request or spawn overflow workers; left out
// here to keep V1 small.
type PoolWorker = {
  worker: Worker
  /** True between postMessage('assign') and the matching 'done' reply. */
  busy: boolean
}
let workerPool: PoolWorker[] | null = null

function getOrCreatePool(): PoolWorker[] {
  if (workerPool) return workerPool
  const { source, options } = workerSpawnArgs()
  workerPool = []
  for (let i = 0; i < WORKER_COUNT; i++) {
    const worker = new Worker(source as never, {
      ...options,
      workerData: { mode: 'pool' },
    })
    // Surface worker errors so a crash doesn't silently leave us with a
    // dead slot. The runner's per-assignment promise also rejects on
    // error, but that one only sees errors during an active assignment.
    worker.on('error', (err) => {
      console.error('[sim-worker] unhandled error', err)
    })
    workerPool.push({ worker, busy: false })
  }
  return workerPool
}

export function shutdownWorkerPool(): void {
  if (!workerPool) return
  for (const w of workerPool) w.worker.postMessage({ type: 'shutdown' })
  workerPool = null
}

/**
 * Spawn the worker pool eagerly. Called from the server's startup so
 * the first simulation doesn't pay the ~1-2s pool-spawn cost on click.
 * Safe to call multiple times — second call no-ops.
 */
export function preWarmWorkerPool(): void {
  if (WORKER_COUNT <= 1) return // inline path; no pool needed
  if (workerPool) return
  getOrCreatePool()
}

/**
 * Aggregated engine timings from the most-recent parallel simulation
 * (workers don't share the main thread's `timings` singleton, so we sum
 * their slices into here at the end of runParallel). Inspected via the
 * /api/simulations/cache-stats endpoint for profiling.
 */
export const lastParallelTimings: EngineTimingsSnapshot & {
  workerCount: number
  runId: string | null
} = {
  dict: 0,
  graphInit: 0,
  collections: 0,
  scalarInputs: 0,
  read: 0,
  total: 0,
  count: 0,
  workerCount: 0,
  runId: null,
}

/**
 * Fan a scenario list out across N worker threads. Each worker gets a
 * contiguous slice; results are merged back in chunk order so the final
 * array matches scenario order (case-detail navigation relies on that).
 */
async function runParallel(
  runId: string,
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
  resultsScope: 'all' | 'outcomes',
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

  const pool = getOrCreatePool()
  // Pool may be larger than chunk count for tiny runs — claim only what we
  // need. Also: if a previous sim left a slot "busy" due to an error path,
  // skip it; the slot will be reclaimed on next pool creation.
  const slots: PoolWorker[] = []
  for (const slot of pool) {
    if (slots.length >= chunks.length) break
    if (slot.busy) continue
    slots.push(slot)
  }
  if (slots.length < chunks.length) {
    throw new Error(
      `Not enough free workers (need ${chunks.length}, have ${slots.length}). ` +
        'Concurrent simulations on the same pool are not supported yet.'
    )
  }

  const workerTimings: EngineTimingsSnapshot[] = []

  const chunkResults: CaseResult[][] = await Promise.all(
    chunks.map(
      (chunk, idx) =>
        new Promise<CaseResult[]>((resolve, reject) => {
          const slot = slots[idx]
          slot.busy = true
          // Per-assignment message handler; detached when this chunk finishes
          // so the next assignment on the same worker doesn't see our state.
          const onMessage = (msg: WorkerMsg) => {
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
              workerTimings.push(msg.timings)
              slot.worker.off('message', onMessage)
              slot.worker.off('error', onError)
              slot.busy = false
              resolve(msg.results)
            }
          }
          const onError = (err: Error) => {
            slot.worker.off('message', onMessage)
            slot.worker.off('error', onError)
            slot.busy = false
            reject(err)
          }
          slot.worker.on('message', onMessage)
          slot.worker.on('error', onError)

          slot.worker.postMessage({
            type: 'assign',
            assignment: {
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
              resultsScope,
            },
          })
        })
    )
  )

  // Sum worker timings and stash for /api/simulations/cache-stats. This
  // makes parallel runs visible to the same profiling endpoint as inline
  // runs (which mutate factgraph-core's `timings` directly on the main
  // thread).
  lastParallelTimings.dict = 0
  lastParallelTimings.graphInit = 0
  lastParallelTimings.collections = 0
  lastParallelTimings.scalarInputs = 0
  lastParallelTimings.read = 0
  lastParallelTimings.total = 0
  lastParallelTimings.count = 0
  for (const t of workerTimings) {
    lastParallelTimings.dict += t.dict
    lastParallelTimings.graphInit += t.graphInit
    lastParallelTimings.collections += t.collections
    lastParallelTimings.scalarInputs += t.scalarInputs
    lastParallelTimings.read += t.read
    lastParallelTimings.total += t.total
    lastParallelTimings.count += t.count
  }
  lastParallelTimings.workerCount = workerTimings.length
  lastParallelTimings.runId = runId

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
  const resultsScope: 'all' | 'outcomes' = config.resultsScope ?? 'all'

  const hasBaseOverrides =
    baseOverrides && Object.keys(baseOverrides).length > 0
  const hasComparedOverrides =
    comparedOverrides && Object.keys(comparedOverrides).length > 0

  // Parallel path: hand the whole scenario list off to a worker pool.
  // Skipped for tiny runs (spawn overhead dominates) and when the user
  // pinned worker count to 1 for benchmarking.
  if (WORKER_COUNT > 1 && scenarios.length >= PARALLEL_THRESHOLD) {
    const results = await runParallel(
      config.id,
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
      resultsScope,
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
  // Don't filter the engine's read pass — see worker.ts for rationale.
  // baseResults/editedResults feed the simulation viewer's "All nodes"
  // tab, and the factgraph-rs engine doesn't pay the O(N²) re-walk
  // cost the Scala.js engine did when reading intermediate paths.
  void outcomeSet
  const readPaths: Set<string> | undefined = undefined
  const skipSecondExecute = sidesAreIdentical(
    baseRulesetId,
    comparedRulesetId,
    baseOverrides,
    comparedOverrides
  )
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

      // Same ruleset, same overrides → second execute is wasted work.
      // Reuse the base result map; diff against itself produces zero diffs.
      const editedResults = skipSecondExecute
        ? baseResults
        : executeFactGraph(
            comparedRulesetId,
            editedFacts,
            comparedInputs,
            editedModel.nodes as Record<string, { content: { dataType?: string } }>,
            scenario.entities,
            readPaths
          )

      const { outcomeDiffs, allDiffs } = skipSecondExecute
        ? { outcomeDiffs: [], allDiffs: [] }
        : diffResults(baseResults, editedResults, outcomeSet)

      // In 'outcomes' scope, shrink the persisted result map to just the
      // outcome paths. Diffs were already computed against the full
      // result above, so this only affects what gets saved to disk.
      const project = (full: Record<string, unknown>) => {
        if (resultsScope === 'all') return full
        const out: Record<string, unknown> = {}
        for (const p of config.outcomeNodes) {
          if (p in full) out[p] = full[p]
        }
        return out
      }

      results.push({
        scenarioId: scenario.id,
        inputs: scenario.inputs,
        entities: scenario.entities,
        baseResults: project(baseResults),
        editedResults: project(editedResults),
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
