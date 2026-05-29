/**
 * Simulation worker — runs a slice of scenarios through `executeFactGraph`
 * and returns the CaseResult array. The main runner partitions scenarios
 * across N workers and merges their outputs.
 *
 * State: each worker is its own Node `worker_threads` thread with an
 * isolated JS heap. The Scala.js bundle (factgraph runtime) is loaded
 * fresh per worker via the executor module's top-level `require`; that
 * cost (~1-2s) happens once per worker.
 *
 * Lifecycle: workers run in "pooled" mode (the default). They sit on a
 * message loop waiting for `assign` messages, process each chunk, and
 * post `done` — then loop back to wait. The runner reuses the pool
 * across simulations, so the bundle load cost is paid once at first use
 * instead of every simulation.
 */
import { parentPort, workerData } from 'node:worker_threads'
import {
  executeFactGraph,
  timings,
  type RawFact,
} from 'rules-visualizer-factgraph-core'
import { compareValues } from '../testStore.js'
import { sidesAreIdentical } from './runner.js'
import type { CaseResult, CaseDiff, GeneratedScenario } from './types.js'

type Assignment = {
  baseRulesetId: string
  comparedRulesetId: string
  baseFacts: RawFact[]
  comparedFacts: RawFact[]
  baseModelNodes: Record<string, { content: { dataType?: string } }>
  comparedModelNodes: Record<string, { content: { dataType?: string } }>
  scenarios: GeneratedScenario[]
  outcomeNodes: string[]
  baseOverrides?: Record<string, unknown>
  comparedOverrides?: Record<string, unknown>
  /** Emit a progress message every N completed scenarios. */
  progressInterval: number
  /** Persistence mode for per-case results. 'all' keeps the full result
   *  map per case (~25KB); 'outcomes' keeps only outcomeNodes values
   *  (~50B), letting case counts scale to millions at the cost of the
   *  "All nodes" diff view. Diffs are still computed against full
   *  outputs — only the persisted CaseResult.baseResults/editedResults
   *  shrink. */
  resultsScope: 'all' | 'outcomes'
}

type AssignMessage = { type: 'assign'; assignment: Assignment }
type ShutdownMessage = { type: 'shutdown' }
type IncomingMessage = AssignMessage | ShutdownMessage

function resetTimings(): void {
  timings.dict = 0
  timings.graphInit = 0
  timings.collections = 0
  timings.scalarInputs = 0
  timings.read = 0
  timings.total = 0
  timings.count = 0
}

function snapshotTimings() {
  return {
    dict: timings.dict,
    graphInit: timings.graphInit,
    collections: timings.collections,
    scalarInputs: timings.scalarInputs,
    read: timings.read,
    total: timings.total,
    count: timings.count,
  }
}

function processAssignment(data: Assignment): CaseResult[] {
  const outcomeSet = new Set(data.outcomeNodes)
  // Don't filter the engine's read pass. baseResults/editedResults feed
  // the simulation viewer's "All nodes" tab — restricting them to
  // outcome paths only would collapse that view to a single row. The
  // Scala.js engine paid an O(N²) re-walk cost for each
  // /members/*/* read, which made the filter worthwhile there; the
  // factgraph-rs engine caches per-fact and the additional reads
  // amount to a JSON-serialize-cost only, which is well worth the UX.
  const readPaths: Set<string> | undefined = undefined
  const hasBaseOverrides =
    data.baseOverrides && Object.keys(data.baseOverrides).length > 0
  const hasComparedOverrides =
    data.comparedOverrides && Object.keys(data.comparedOverrides).length > 0
  // Same ruleset + same overrides → second execute is guaranteed identical;
  // skip it and reuse the base result map. Halves wall time for same-vs-same.
  const skipSecondExecute = sidesAreIdentical(
    data.baseRulesetId,
    data.comparedRulesetId,
    data.baseOverrides,
    data.comparedOverrides
  )

  function diffResults(
    base: Record<string, unknown>,
    edited: Record<string, unknown>
  ): { outcomeDiffs: CaseDiff[]; allDiffs: CaseDiff[] } {
    const allDiffs: CaseDiff[] = []
    const outcomeDiffs: CaseDiff[] = []
    const allPaths = new Set([...Object.keys(base), ...Object.keys(edited)])
    for (const p of allPaths) {
      const bv = base[p]
      const ev = edited[p]
      let diff: CaseDiff | null = null
      if (!(p in base)) {
        diff = { path: p, baseValue: undefined, editedValue: ev, changeType: 'added' }
      } else if (!(p in edited)) {
        diff = { path: p, baseValue: bv, editedValue: undefined, changeType: 'removed' }
      } else if (!compareValues(bv, ev)) {
        diff = { path: p, baseValue: bv, editedValue: ev, changeType: 'changed' }
      }
      if (diff) {
        allDiffs.push(diff)
        if (outcomeSet.has(p)) outcomeDiffs.push(diff)
      }
    }
    return { outcomeDiffs, allDiffs }
  }

  // In 'outcomes' mode we still compute the full graph (engine has to,
  // to reach the outcome leaves), but we shrink the per-case persisted
  // map down to the outcomeNodes set before pushing into the results
  // array. That keeps the IPC payload back to the main thread small
  // and lets the main thread accumulate millions of cases without
  // blowing the heap.
  const projectForStorage = (full: Record<string, unknown>) => {
    if (data.resultsScope === 'all') return full
    const out: Record<string, unknown> = {}
    for (const p of data.outcomeNodes) {
      if (p in full) out[p] = full[p]
    }
    return out
  }

  const results: CaseResult[] = []
  for (let i = 0; i < data.scenarios.length; i++) {
    const scenario = data.scenarios[i]
    try {
      const baseInputs = hasBaseOverrides
        ? { ...scenario.inputs, ...data.baseOverrides }
        : scenario.inputs
      const comparedInputs = hasComparedOverrides
        ? { ...scenario.inputs, ...data.comparedOverrides }
        : scenario.inputs

      const baseResults = executeFactGraph(
        data.baseRulesetId,
        data.baseFacts,
        baseInputs,
        data.baseModelNodes,
        scenario.entities,
        readPaths
      )
      const editedResults = skipSecondExecute
        ? baseResults
        : executeFactGraph(
            data.comparedRulesetId,
            data.comparedFacts,
            comparedInputs,
            data.comparedModelNodes,
            scenario.entities,
            readPaths
          )

      const { outcomeDiffs, allDiffs } = skipSecondExecute
        ? { outcomeDiffs: [] as CaseDiff[], allDiffs: [] as CaseDiff[] }
        : diffResults(baseResults, editedResults)

      results.push({
        scenarioId: scenario.id,
        inputs: scenario.inputs,
        entities: scenario.entities,
        baseResults: projectForStorage(baseResults),
        editedResults: projectForStorage(editedResults),
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

    if (i > 0 && i % data.progressInterval === 0) {
      parentPort?.postMessage({ type: 'progress', count: i })
    }
  }

  return results
}

// In pooled mode (the new default), wait for assignments via message.
// In one-shot legacy mode (workerData has the assignment fields), process
// once and exit — kept for callers that haven't migrated.
const initialData = workerData as
  | { mode?: 'pool' }
  | (Assignment & { mode?: never })
  | undefined

if ((initialData as { mode?: string })?.mode === 'pool') {
  parentPort?.on('message', (msg: IncomingMessage) => {
    if (msg.type === 'shutdown') {
      process.exit(0)
    }
    if (msg.type === 'assign') {
      resetTimings()
      const results = processAssignment(msg.assignment)
      parentPort?.postMessage({
        type: 'done',
        results,
        timings: snapshotTimings(),
      })
    }
  })
} else if (initialData) {
  // Legacy one-shot mode.
  const results = processAssignment(initialData as Assignment)
  parentPort?.postMessage({
    type: 'done',
    results,
    timings: snapshotTimings(),
  })
}
