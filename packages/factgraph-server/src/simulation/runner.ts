/**
 * Simulation runner — executes scenarios against two ruleset versions and
 * compares results.
 */

import { getRuleset, getRawFacts } from '../store.js'
import { executeFactGraph } from '../executor.js'
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
 * Run a full simulation: generate or use provided scenarios, execute both
 * versions, diff, summarize.
 *
 * @param prebuiltScenarios - If provided, uses these instead of generating
 *   random scenarios. Used for saved population cases.
 */
export async function runSimulation(
  baseRulesetId: string,
  comparedRulesetId: string,
  config: SimulationConfig,
  onProgress?: (completed: number, total: number) => void,
  prebuiltScenarios?: GeneratedScenario[]
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

  // Execute and compare
  const results: CaseResult[] = []
  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i]
    try {
      const baseResults = executeFactGraph(
        baseRulesetId,
        baseFacts,
        scenario.inputs,
        baseModel.nodes as Record<string, { content: { dataType?: string } }>,
        scenario.entities
      )

      const editedResults = executeFactGraph(
        comparedRulesetId,
        editedFacts,
        scenario.inputs,
        editedModel.nodes as Record<string, { content: { dataType?: string } }>,
        scenario.entities
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
