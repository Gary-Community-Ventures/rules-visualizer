const API_BASE = import.meta.env.VITE_API_URL ?? ''

// --- Types (mirrors backend simulation/types.ts) ---

export type FieldConfig = {
  path: string
  type: 'Dollar' | 'Int' | 'Short' | 'Byte' | 'Boolean' | 'Enum' | 'String'
  min?: number
  max?: number
  enumOptions?: string[]
  trueProbability?: number
}

export type CollectionConfig = {
  collectionPath: string
  minMembers: number
  maxMembers: number
  fields: FieldConfig[]
}

export type SimulationConfig = {
  id: string
  seed: number
  caseCount: number
  outcomeNodes: string[]
  scalarFields: FieldConfig[]
  collections: CollectionConfig[]
}

export type CaseDiff = {
  path: string
  baseValue: unknown
  editedValue: unknown
  changeType: 'changed' | 'added' | 'removed'
}

export type CaseResult = {
  scenarioId: number
  inputs: Record<string, unknown>
  entities?: Record<string, Record<string, unknown>[]>
  baseResults: Record<string, unknown>
  editedResults: Record<string, unknown>
  outcomeDiffs: CaseDiff[]
  allDiffs: CaseDiff[]
  changed: boolean
  error?: string
}

export type NodeChangeStats = {
  path: string
  timesChanged: number
  timesIncreased: number
  timesDecreased: number
  avgDelta?: number
}

export type SimulationSummary = {
  totalCases: number
  changedCases: number
  unchangedCases: number
  errorCases: number
  nodeChanges: NodeChangeStats[]
  executionTimeMs: number
}

export type SimulationRun = {
  id: string
  name?: string
  rulesetId: string
  comparedRulesetId: string
  config: SimulationConfig
  status: 'running' | 'completed' | 'failed'
  progress?: { completed: number; total: number }
  summary?: SimulationSummary
  populationId?: string
  populationName?: string
  baseOverrides?: Record<string, unknown>
  comparedOverrides?: Record<string, unknown>
  startedAt: string
  completedAt?: string
  error?: string
}

// --- API functions ---

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
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
    throw new Error(data.error ?? `API error: ${res.status}`)
  }
  return res.json()
}

export async function configureSimulation(
  rulesetId: string,
  overrides?: Partial<SimulationConfig>
): Promise<SimulationConfig> {
  return post(
    `/api/rulesets/${rulesetId}/simulations/configure`,
    overrides ?? {}
  )
}

export async function runSimulation(
  rulesetId: string,
  config: SimulationConfig,
  comparedRulesetId: string,
  opts: {
    populationId?: string
    baseOverrides?: Record<string, unknown>
    comparedOverrides?: Record<string, unknown>
  } = {}
): Promise<SimulationRun> {
  return post(`/api/rulesets/${rulesetId}/simulations/run`, {
    config,
    comparedRulesetId,
    populationId: opts.populationId,
    baseOverrides: opts.baseOverrides,
    comparedOverrides: opts.comparedOverrides,
  })
}

export async function listSimulations(
  rulesetId: string
): Promise<SimulationRun[]> {
  return get(`/api/rulesets/${rulesetId}/simulations`)
}

export async function getSimulationRun(
  rulesetId: string,
  runId: string
): Promise<SimulationRun> {
  return get(`/api/rulesets/${rulesetId}/simulations/${runId}`)
}

export async function getSimulationResults(
  rulesetId: string,
  runId: string,
  opts: {
    offset: number
    limit: number
    filter: 'all' | 'changed' | 'unchanged'
  }
): Promise<{ results: CaseResult[]; total: number; changedTotal: number }> {
  const params = new URLSearchParams({
    offset: String(opts.offset),
    limit: String(opts.limit),
    filter: opts.filter,
  })
  return get(
    `/api/rulesets/${rulesetId}/simulations/${runId}/results?${params}`
  )
}

// --- Populations ---

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

export async function listPopulations(): Promise<Population[]> {
  return get('/api/populations')
}

export async function getPopulationById(id: string): Promise<Population> {
  return get(`/api/populations/${id}`)
}

export type FromRunSpec = {
  rulesetId: string
  runId: string
  filter?: 'all' | 'changed' | 'unchanged'
  scenarioIds?: number[]
}

export async function createPopulation(
  name: string,
  cases: PopulationCase[],
  description?: string
): Promise<Population> {
  return post('/api/populations', { name, cases, description })
}

export async function createPopulationFromRun(
  name: string,
  fromRun: FromRunSpec,
  description?: string
): Promise<Population> {
  return post('/api/populations', { name, fromRun, description })
}

export async function addCasesToPopulation(
  populationId: string,
  cases: PopulationCase[]
): Promise<Population> {
  return post(`/api/populations/${populationId}/cases`, { cases })
}

export async function addCasesToPopulationFromRun(
  populationId: string,
  fromRun: FromRunSpec
): Promise<Population> {
  return post(`/api/populations/${populationId}/cases`, { fromRun })
}

export async function updatePopulation(
  populationId: string,
  patch: { name?: string; description?: string | null }
): Promise<Population> {
  const res = await fetch(`${API_BASE}/api/populations/${populationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? `API error: ${res.status}`)
  }
  return res.json()
}

export async function updateCaseInPopulation(
  populationId: string,
  caseId: number,
  patch: {
    name?: string
    inputs?: Record<string, unknown>
    entities?: Record<string, Record<string, unknown>[]>
  }
): Promise<Population> {
  const res = await fetch(
    `${API_BASE}/api/populations/${populationId}/cases/${caseId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }
  )
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? `API error: ${res.status}`)
  }
  return res.json()
}

export async function removeCaseFromPopulation(
  populationId: string,
  caseId: number
): Promise<Population> {
  const res = await fetch(
    `${API_BASE}/api/populations/${populationId}/cases/${caseId}`,
    { method: 'DELETE' }
  )
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? `API error: ${res.status}`)
  }
  return res.json()
}

export async function deletePopulationApi(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/populations/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
}

export async function deleteSimulation(
  rulesetId: string,
  runId: string
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/rulesets/${rulesetId}/simulations/${runId}`,
    { method: 'DELETE' }
  )
  if (!res.ok) throw new Error(`API error: ${res.status}`)
}

export async function updateSimulationRun(
  rulesetId: string,
  runId: string,
  patch: { name?: string | null }
): Promise<SimulationRun> {
  const res = await fetch(
    `${API_BASE}/api/rulesets/${rulesetId}/simulations/${runId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }
  )
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? `API error: ${res.status}`)
  }
  return res.json()
}
