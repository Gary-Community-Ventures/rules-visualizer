import type { Model, NodeTestCase, IntegrationTestCase } from '@/lib/model'
import type { ExecutionResult } from '@/lib/engine'

// VITE_API_URL if set, otherwise same origin as the socket server, otherwise
// empty string (relative — works with the Vite dev proxy).
const BASE_URL = import.meta.env.VITE_API_URL ?? import.meta.env.VITE_SOCKET_URL ?? ''

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`)
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    const message = data?.error ?? `Request failed (${response.status})`
    throw new Error(message)
  }
  return response.json()
}

async function post<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const data = await response.json().catch(() => null)
    const message = data?.error ?? `Request failed (${response.status})`
    throw new Error(message)
  }

  return response.json()
}

export async function exportDmnXml(model: Model): Promise<string> {
  const data = await post<{ xml: string }>('/api/dmn/export', { model })
  return data.xml
}

export async function executeDmn(
  model: Model,
  inputValues: Record<string, unknown>,
  signal?: AbortSignal
): Promise<ExecutionResult> {
  return post<ExecutionResult>('/api/dmn/execute', { model, inputValues }, signal)
}

export type TestResult = {
  passed: boolean
  actual: string
  status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'NOT_EVALUATED'
  messages: string[]
}

export type IntegrationTestResult = {
  passed: boolean
  assertionResults: Record<string, TestResult>
}

export async function runNodeTest(
  model: Model,
  targetNodeId: string,
  testCase: NodeTestCase,
  signal?: AbortSignal
): Promise<TestResult> {
  return post<TestResult>(
    '/api/dmn/test/node',
    { model, targetNodeId, testCase },
    signal
  )
}

export async function runIntegrationTest(
  model: Model,
  testCase: IntegrationTestCase,
  signal?: AbortSignal
): Promise<IntegrationTestResult> {
  return post<IntegrationTestResult>(
    '/api/dmn/test/integration',
    { model, testCase },
    signal
  )
}

export async function listProjects(): Promise<{
  projects: { id: string; name: string; created_at: string; updated_at: string }[]
}> {
  return get('/api/dmn/projects')
}

export async function createProject(
  name: string
): Promise<{ id: string; name: string }> {
  return post('/api/dmn/projects', { name })
}

export async function listProjectModels(projectId: string): Promise<{
  models: { id: string; name: string; namespace: string; updated_at: string }[]
}> {
  return get(`/api/dmn/projects/${projectId}/models`)
}

export async function createProjectModel(
  projectId: string,
  name: string,
  namespace: string
): Promise<{ id: string; name: string; namespace: string }> {
  return post(`/api/dmn/projects/${projectId}/models`, { name, namespace })
}
