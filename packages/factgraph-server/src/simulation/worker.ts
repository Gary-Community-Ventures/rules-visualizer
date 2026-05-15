/**
 * Simulation worker — runs a slice of scenarios through `executeFactGraph`
 * and returns the CaseResult array. The main runner partitions scenarios
 * across N workers and merges their outputs.
 *
 * State: each worker is its own Node `worker_threads` thread with an
 * isolated JS heap. It receives the parsed RawFacts + Model.nodes for
 * both rulesets via workerData (structured-cloned once per spawn) so it
 * doesn't have to re-parse XML from disk. The Scala.js bundle (factgraph
 * runtime) is loaded fresh per worker via the executor module's top-level
 * `require`; that cost (~1-2s) happens once per worker, in parallel.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { executeFactGraph } from '../executor.js'
import { compareValues } from '../testStore.js'
import type {
  CaseResult,
  CaseDiff,
  GeneratedScenario,
} from './types.js'
import type { RawFact } from '../store.js'

type WorkerInit = {
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
}

const data = workerData as WorkerInit
const outcomeSet = new Set(data.outcomeNodes)
const hasBaseOverrides =
  data.baseOverrides && Object.keys(data.baseOverrides).length > 0
const hasComparedOverrides =
  data.comparedOverrides && Object.keys(data.comparedOverrides).length > 0

function diffResults(
  base: Record<string, unknown>,
  edited: Record<string, unknown>
): { outcomeDiffs: CaseDiff[]; allDiffs: CaseDiff[] } {
  const allDiffs: CaseDiff[] = []
  const outcomeDiffs: CaseDiff[] = []
  const allPaths = new Set([...Object.keys(base), ...Object.keys(edited)])

  for (const path of allPaths) {
    const bv = base[path]
    const ev = edited[path]

    let diff: CaseDiff | null = null

    if (!(path in base)) {
      diff = { path, baseValue: undefined, editedValue: ev, changeType: 'added' }
    } else if (!(path in edited)) {
      diff = { path, baseValue: bv, editedValue: undefined, changeType: 'removed' }
    } else if (!compareValues(bv, ev)) {
      diff = { path, baseValue: bv, editedValue: ev, changeType: 'changed' }
    }

    if (diff) {
      allDiffs.push(diff)
      if (outcomeSet.has(path)) outcomeDiffs.push(diff)
    }
  }

  return { outcomeDiffs, allDiffs }
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
      scenario.entities
    )
    const editedResults = executeFactGraph(
      data.comparedRulesetId,
      data.comparedFacts,
      comparedInputs,
      data.comparedModelNodes,
      scenario.entities
    )

    const { outcomeDiffs, allDiffs } = diffResults(baseResults, editedResults)

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

  if (i > 0 && i % data.progressInterval === 0) {
    parentPort?.postMessage({ type: 'progress', count: i })
  }
}

parentPort?.postMessage({ type: 'done', results })
