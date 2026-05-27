/** Configuration for a single input field in scenario generation */
export type FieldConfig = {
  path: string
  type:
    | 'Dollar'
    | 'Int'
    | 'Short'
    | 'Byte'
    | 'Boolean'
    | 'Enum'
    | 'MultiEnum'
    | 'String'
    | 'Day'
    | 'Rational'
    | 'CollectionItem'
    | string
  min?: number
  max?: number
  minDate?: string
  maxDate?: string
  stringOptions?: string[]
  enumOptions?: string[]
  collectionItemPath?: string
  /** Probability a CollectionItem link is populated (0–1). Default 1. */
  linkProbability?: number
  /** Per-option generation probabilities (0–1), keyed by enum option. */
  enumProbabilities?: Record<string, number>
  /** Probability a Boolean field generates `true` (0–1). Default 0.5. */
  trueProbability?: number
}

/** Configuration for a collection (e.g., /members) */
export type CollectionConfig = {
  collectionPath: string
  minMembers: number
  maxMembers: number
  fields: FieldConfig[]
}

/** Full configuration for a simulation run */
export type SimulationConfig = {
  id: string
  seed: number
  caseCount: number
  /** Leaf node paths used for the summary diff (e.g., ["/eligible", "/snap"]) */
  outcomeNodes: string[]
  scalarFields: FieldConfig[]
  collections: CollectionConfig[]
}

/** A single generated test scenario */
export type GeneratedScenario = {
  id: number
  inputs: Record<string, unknown>
  entities?: Record<string, Record<string, unknown>[]>
}

/** A single diff between base and edited results for one node */
export type CaseDiff = {
  path: string
  baseValue: unknown
  editedValue: unknown
  changeType: 'changed' | 'added' | 'removed'
}

/** Full result for one scenario, comparing base vs edited */
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

/** Per-node aggregate statistics across all cases */
export type NodeChangeStats = {
  path: string
  timesChanged: number
  timesIncreased: number
  timesDecreased: number
  avgDelta?: number
}

/** Summary statistics for a completed simulation run */
export type SimulationSummary = {
  totalCases: number
  changedCases: number
  unchangedCases: number
  errorCases: number
  nodeChanges: NodeChangeStats[]
  executionTimeMs: number
}

/** A simulation run (persisted metadata) */
export type SimulationRun = {
  id: string
  /** Optional user-set label. Falls back to auto-formatted ruleset+overrides
   *  summary in the UI when blank. */
  name?: string
  rulesetId: string
  comparedRulesetId: string
  config: SimulationConfig
  status: 'running' | 'completed' | 'failed'
  progress?: { completed: number; total: number }
  summary?: SimulationSummary
  /** If the run used a saved population, its ID at run time. */
  populationId?: string
  /** Snapshot of the population's name (so deleted pops still display). */
  populationName?: string
  /** Path → value overrides merged into every scenario's inputs on the base side. */
  baseOverrides?: Record<string, unknown>
  /** Path → value overrides merged into every scenario's inputs on the compared side. */
  comparedOverrides?: Record<string, unknown>
  startedAt: string
  completedAt?: string
  error?: string
}
