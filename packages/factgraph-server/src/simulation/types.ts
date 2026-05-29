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
  /** Numeric min for Dollar/Int/Short/Byte/Rational. */
  min?: number
  /** Numeric max for Dollar/Int/Short/Byte/Rational. */
  max?: number
  /** ISO YYYY-MM-DD min for Day. Defaults to 2000-01-01. */
  minDate?: string
  /** ISO YYYY-MM-DD max for Day. Defaults to today. */
  maxDate?: string
  /** Options for Enum / MultiEnum. */
  enumOptions?: string[]
  /** Options for String picker, if you want to constrain the generated values. */
  stringOptions?: string[]
  /** Target collection path for CollectionItem links. */
  collectionItemPath?: string
  /** Probability a CollectionItem link is populated (0–1). Default 1. */
  linkProbability?: number
  /**
   * Per-option generation probabilities (0–1), keyed by enum option name.
   * For Enum fields: relative weights for weighted sampling (normalized).
   * For MultiEnum: independent probability of including each option.
   * Default behavior when missing: uniform sampling (Enum) or 35% include
   * (MultiEnum).
   */
  enumProbabilities?: Record<string, number>
  /** Probability a Boolean field generates `true` (0–1). Default 0.5. */
  trueProbability?: number
}

/** Configuration for a collection (e.g., /members) */
export type CollectionConfig = {
  collectionPath: string
  minMembers: number
  maxMembers: number
  /**
   * If true, bias collection size toward smaller values via a power-law
   * distribution (closer to real-world household sizes). Default false =
   * uniform sampling between min and max. autoConfigFromModel turns this
   * on for `/members` since SNAP/Medicaid-style household sizes follow a
   * roughly 1.5-power decay.
   */
  weighted?: boolean
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
  /** What the run is doing right now, while status === 'running'.
   *  - generating: building the scenario list (CPU-bound, blocks the main
   *    thread; user sees no progress events here, so the UI shows a label
   *    rather than a percent).
   *  - executing: scenarios are being processed by the worker pool;
   *    progress.completed advances during this phase.
   *  - finalizing: writing results to disk + computing summary.
   *  Omitted on completed/failed runs. */
  phase?: 'generating' | 'executing' | 'finalizing'
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
