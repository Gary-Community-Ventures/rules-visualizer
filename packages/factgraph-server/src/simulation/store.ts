/**
 * Simulation persistence — stores runs as JSON config + JSONL results.
 */

import fs from 'node:fs'
import path from 'node:path'
import { getDataDir } from 'rules-visualizer-factgraph-core'
import type { SimulationRun, CaseResult } from './types.js'

// In-memory store for active (running) simulations — tracks progress
const activeRuns = new Map<string, SimulationRun>()

export function setActiveRun(run: SimulationRun): void {
  activeRuns.set(run.id, run)
}

export function getActiveRun(runId: string): SimulationRun | undefined {
  return activeRuns.get(runId)
}

export function clearActiveRun(runId: string): void {
  activeRuns.delete(runId)
}

function getSimDir(rulesetId: string): string | null {
  const dataDir = getDataDir()
  if (!dataDir) return null
  return path.join(dataDir, rulesetId, 'simulations')
}

function getRunDir(rulesetId: string, runId: string): string | null {
  const simDir = getSimDir(rulesetId)
  if (!simDir) return null
  return path.join(simDir, runId)
}

/** Persist a completed simulation run and its results. */
export function saveSimulationRun(
  run: SimulationRun,
  results: CaseResult[]
): void {
  const dir = getRunDir(run.rulesetId, run.id)
  if (!dir) throw new Error('No data directory configured')

  fs.mkdirSync(dir, { recursive: true })

  // Save config
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify(run.config, null, 2) + '\n'
  )

  // Save run metadata + summary (without the full config to avoid duplication)
  const { config: _, ...runMeta } = run
  fs.writeFileSync(
    path.join(dir, 'summary.json'),
    JSON.stringify(runMeta, null, 2) + '\n'
  )

  // Save results as JSONL (one case per line)
  const ws = fs.createWriteStream(path.join(dir, 'results.jsonl'))
  ws.on('error', (err) => {
    console.error(`Failed to write simulation results: ${err.message}`)
  })
  for (const result of results) {
    ws.write(JSON.stringify(result) + '\n')
  }
  ws.end()
}

/** List all simulation runs for a ruleset. */
export function listSimulationRuns(rulesetId: string): SimulationRun[] {
  const simDir = getSimDir(rulesetId)
  if (!simDir || !fs.existsSync(simDir)) return []

  const runs: SimulationRun[] = []
  const entries = fs.readdirSync(simDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const runDir = path.join(simDir, entry.name)
    const summaryPath = path.join(runDir, 'summary.json')
    const configPath = path.join(runDir, 'config.json')

    if (!fs.existsSync(summaryPath) || !fs.existsSync(configPath)) continue

    try {
      const meta = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'))
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      runs.push({ ...meta, config })
    } catch {
      // Skip malformed run directories
    }
  }

  return runs.sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  )
}

/** Get a single simulation run by ID. */
export function getSimulationRun(
  rulesetId: string,
  runId: string
): SimulationRun | null {
  const dir = getRunDir(rulesetId, runId)
  if (!dir) return null

  const summaryPath = path.join(dir, 'summary.json')
  const configPath = path.join(dir, 'config.json')

  if (!fs.existsSync(summaryPath) || !fs.existsSync(configPath)) return null

  try {
    const meta = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'))
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    return { ...meta, config }
  } catch {
    return null
  }
}

/** Load paginated case results from a simulation run. */
export function loadCaseResults(
  rulesetId: string,
  runId: string,
  offset: number,
  limit: number,
  filter: 'all' | 'changed' | 'unchanged' = 'all'
): { results: CaseResult[]; total: number; changedTotal: number } {
  const dir = getRunDir(rulesetId, runId)
  if (!dir) return { results: [], total: 0, changedTotal: 0 }

  const filePath = path.join(dir, 'results.jsonl')
  if (!fs.existsSync(filePath))
    return { results: [], total: 0, changedTotal: 0 }

  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean)
  const allResults: CaseResult[] = lines.map((line) => JSON.parse(line))

  const changedTotal = allResults.filter((r) => r.changed).length

  let filtered: CaseResult[]
  if (filter === 'changed') {
    filtered = allResults.filter((r) => r.changed)
  } else if (filter === 'unchanged') {
    filtered = allResults.filter((r) => !r.changed)
  } else {
    filtered = allResults
  }

  return {
    results: filtered.slice(offset, offset + limit),
    total: filtered.length,
    changedTotal,
  }
}

/**
 * Read cases from a run's results.jsonl and project them to PopulationCase
 * shape (id + inputs + entities). Used for server-side "save from run"
 * imports so the frontend doesn't need to round-trip the data.
 */
export function loadCasesFromRun(
  rulesetId: string,
  runId: string,
  opts: {
    filter?: 'all' | 'changed' | 'unchanged'
    scenarioIds?: number[]
  } = {}
): {
  id: number
  inputs: Record<string, unknown>
  entities?: Record<string, Record<string, unknown>[]>
}[] {
  const dir = getRunDir(rulesetId, runId)
  if (!dir) return []
  const filePath = path.join(dir, 'results.jsonl')
  if (!fs.existsSync(filePath)) return []

  const idSet = opts.scenarioIds ? new Set(opts.scenarioIds) : null
  const filter = opts.filter ?? 'all'

  const cases: ReturnType<typeof loadCasesFromRun> = []
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n')
  for (const line of lines) {
    if (!line) continue
    let r: CaseResult
    try {
      r = JSON.parse(line)
    } catch {
      continue
    }
    if (idSet && !idSet.has(r.scenarioId)) continue
    if (filter === 'changed' && !r.changed) continue
    if (filter === 'unchanged' && r.changed) continue
    cases.push({
      id: r.scenarioId,
      inputs: r.inputs,
      entities: r.entities,
    })
  }
  return cases
}

/**
 * Patch a persisted run's metadata in place. Currently only used for
 * renaming. Rewrites summary.json with the merged fields.
 */
export function updateSimulationRunMetadata(
  rulesetId: string,
  runId: string,
  patch: Partial<Pick<SimulationRun, 'name'>>
): SimulationRun | null {
  const dir = getRunDir(rulesetId, runId)
  if (!dir) return null
  const summaryPath = path.join(dir, 'summary.json')
  if (!fs.existsSync(summaryPath)) return null

  const meta = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'))
  if ('name' in patch) {
    if (patch.name && patch.name.trim() !== '') {
      meta.name = patch.name.trim()
    } else {
      delete meta.name
    }
  }

  fs.writeFileSync(summaryPath, JSON.stringify(meta, null, 2) + '\n')
  return getSimulationRun(rulesetId, runId)
}

/** Delete a simulation run and its data. */
export function deleteSimulationRun(rulesetId: string, runId: string): boolean {
  const dir = getRunDir(rulesetId, runId)
  if (!dir || !fs.existsSync(dir)) return false

  fs.rmSync(dir, { recursive: true, force: true })
  return true
}
