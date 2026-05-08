/**
 * Saved case populations — named sets of household scenarios
 * shared across rulesets. Each population is just inputs (no expected
 * outputs), so any ruleset version can be run against them.
 */

import fs from 'node:fs'
import path from 'node:path'
import { getDataDir } from '../store.js'
import type { GeneratedScenario } from './types.js'

export type PopulationCase = {
  id: number
  name?: string
  tags?: string[]
  inputs: Record<string, unknown>
  entities?: Record<string, Record<string, unknown>[]>
}

export type Population = {
  id: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
  cases: PopulationCase[]
}

function getPopulationsDir(): string | null {
  const dataDir = getDataDir()
  if (!dataDir) return null
  const dir = path.join(dataDir, '..', 'populations')
  return dir
}

function getPopulationPath(populationId: string): string | null {
  const dir = getPopulationsDir()
  if (!dir) return null
  return path.join(dir, `${populationId}.json`)
}

/** List all populations. */
export function listPopulations(): Population[] {
  const dir = getPopulationsDir()
  if (!dir || !fs.existsSync(dir)) return []

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  const populations: Population[] = []

  for (const file of files) {
    try {
      const data = JSON.parse(
        fs.readFileSync(path.join(dir, file), 'utf-8')
      )
      populations.push(data)
    } catch {
      // Skip malformed files
    }
  }

  return populations.sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
}

/** Get a single population by ID. */
export function getPopulation(id: string): Population | null {
  const filePath = getPopulationPath(id)
  if (!filePath || !fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

/** Create a new population. */
export function createPopulation(
  name: string,
  cases: PopulationCase[],
  description?: string
): Population {
  const dir = getPopulationsDir()
  if (!dir) throw new Error('No data directory configured')
  fs.mkdirSync(dir, { recursive: true })

  const now = new Date().toISOString()
  const population: Population = {
    id: crypto.randomUUID(),
    name,
    description,
    createdAt: now,
    updatedAt: now,
    cases,
  }

  fs.writeFileSync(
    path.join(dir, `${population.id}.json`),
    JSON.stringify(population, null, 2) + '\n'
  )

  return population
}

/** Add cases to an existing population. */
export function addCasesToPopulation(
  populationId: string,
  newCases: PopulationCase[]
): Population | null {
  const population = getPopulation(populationId)
  if (!population) return null

  // Auto-increment IDs
  const maxId = population.cases.reduce(
    (max, c) => Math.max(max, c.id),
    -1
  )
  const numbered = newCases.map((c, i) => ({
    ...c,
    id: maxId + 1 + i,
  }))

  population.cases.push(...numbered)
  population.updatedAt = new Date().toISOString()

  const filePath = getPopulationPath(populationId)
  if (!filePath) return null
  fs.writeFileSync(
    filePath,
    JSON.stringify(population, null, 2) + '\n'
  )

  return population
}

/** Remove a case from a population. */
export function removeCaseFromPopulation(
  populationId: string,
  caseId: number
): Population | null {
  const population = getPopulation(populationId)
  if (!population) return null

  population.cases = population.cases.filter((c) => c.id !== caseId)
  population.updatedAt = new Date().toISOString()

  const filePath = getPopulationPath(populationId)
  if (!filePath) return null
  fs.writeFileSync(
    filePath,
    JSON.stringify(population, null, 2) + '\n'
  )

  return population
}

/** Delete a population. */
export function deletePopulation(id: string): boolean {
  const filePath = getPopulationPath(id)
  if (!filePath || !fs.existsSync(filePath)) return false
  fs.unlinkSync(filePath)
  return true
}

/** Convert simulation scenarios to population cases. */
export function scenariosToPopulationCases(
  scenarios: GeneratedScenario[]
): PopulationCase[] {
  return scenarios.map((s) => ({
    id: s.id,
    inputs: s.inputs,
    entities: s.entities,
  }))
}

/** Convert population cases to the format the runner expects. */
export function populationCasesToScenarios(
  cases: PopulationCase[]
): GeneratedScenario[] {
  return cases.map((c) => ({
    id: c.id,
    inputs: c.inputs,
    entities: c.entities,
  }))
}
