import type { Model, RuleFormat } from '@/lib/model'
import { MOCK_RULESETS, MOCK_MODELS } from './mock-data'

const API_BASE = import.meta.env.VITE_API_URL ?? ''
const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

export type RulesetSummary = { id: string; name: string; format: RuleFormat }

export type NodeResult = {
  value: unknown
  entity?: string
}

export type ExecutionResults = Record<string, NodeResult>

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? `API error: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

export async function listRulesets(): Promise<RulesetSummary[]> {
  if (USE_MOCK) return MOCK_RULESETS

  try {
    const data = await get<{ rulesets: RulesetSummary[] }>('/api/rulesets')
    return data.rulesets
  } catch {
    console.warn('Backend unavailable, falling back to mock data')
    return MOCK_RULESETS
  }
}

export async function getRuleset(rulesetId: string): Promise<Model> {
  if (USE_MOCK) {
    const model = MOCK_MODELS[rulesetId]
    if (!model) throw new Error(`Ruleset "${rulesetId}" not found`)
    return model
  }

  try {
    return await get<Model>(`/api/rulesets/${rulesetId}`)
  } catch {
    console.warn(
      `Backend unavailable for ruleset "${rulesetId}", falling back to mock data`
    )
    const model = MOCK_MODELS[rulesetId]
    if (!model) throw new Error(`Ruleset "${rulesetId}" not found`)
    return model
  }
}

// --- Test API ---

export type TestCase = {
  id: string
  name: string
  description?: string
  asOf?: string
  inputs?: Record<string, unknown>
  entities?: Record<string, Record<string, unknown>[]>
  overrides?: Record<string, unknown>
  expect: Record<string, unknown>
}

export type TestExpectation = {
  expected: unknown
  actual: unknown
  passed: boolean
}

export type TestRunResult = {
  testId: string
  name: string
  passed: boolean
  error?: string
  expectations: Record<string, TestExpectation>
  computedValues?: Record<string, unknown>
}

export async function listTests(rulesetId: string): Promise<TestCase[]> {
  const data = await get<{ tests: TestCase[] }>(
    `/api/rulesets/${rulesetId}/tests`
  )
  return data.tests
}

export async function createTest(
  rulesetId: string,
  test: Omit<TestCase, 'id'>
): Promise<TestCase> {
  return post<TestCase>(`/api/rulesets/${rulesetId}/tests`, test)
}

export async function updateTest(
  rulesetId: string,
  testId: string,
  updates: Partial<TestCase>
): Promise<TestCase> {
  const res = await fetch(
    `${API_BASE}/api/rulesets/${rulesetId}/tests/${testId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }
  )
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function deleteTest(
  rulesetId: string,
  testId: string
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/rulesets/${rulesetId}/tests/${testId}`,
    {
      method: 'DELETE',
    }
  )
  if (!res.ok) throw new Error(`API error: ${res.status}`)
}

export async function runTests(
  rulesetId: string,
  testIds?: string[]
): Promise<TestRunResult[]> {
  const data = await post<{ results: TestRunResult[] }>(
    `/api/rulesets/${rulesetId}/tests/run`,
    testIds ? { testIds } : {}
  )
  return data.results
}

export async function executeRuleset(
  rulesetId: string,
  inputs: Record<string, unknown>,
  entities?: Record<string, unknown[]>,
  asOfDate?: string
): Promise<ExecutionResults> {
  const data = await post<{ results: ExecutionResults }>(
    `/api/rulesets/${rulesetId}/execute`,
    { inputs, entities, as_of: asOfDate }
  )
  return data.results
}
