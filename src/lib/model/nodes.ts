import type {
  FeelDataType,
  ContextEntry,
  HitPolicy,
  Aggregation,
  InputClause,
  OutputClause,
  DecisionTableRule,
} from './types'

// ─── Node Content Types (discriminated on `type`) ────────────────

export type Input = {
  type: 'input'
  id: string
  defaultValue: string
}

export type Constant = {
  type: 'constant'
  text: string
  typeRef?: FeelDataType
}

export type Context = {
  type: 'context'
  entries: ContextEntry[]
  // Convention: entry named '_return' is the final result
}

export type DecisionTable = {
  type: 'decisionTable'
  hitPolicy: HitPolicy
  aggregation?: Aggregation
  inputClauses: InputClause[]
  outputClauses: OutputClause[]
  rules: DecisionTableRule[]
}

export type NodeContent = Input | Constant | Context | DecisionTable

// ─── Test Cases ─────────────────────────────────────────────────

export type NodeTestCase = {
  id: string
  name: string
  inputs: Record<string, unknown>
  expected: string
}

// ─── Node & Model ────────────────────────────────────────────────

export type ModelNode = {
  id: string
  name: string
  typeRef?: FeelDataType
  dependencies: string[]
  content: NodeContent
  tests?: NodeTestCase[]
  deletedVersion?: string
}

export type ModelNodes = Record<string, ModelNode>

export type Model = {
  id: string
  name: string
  namespace: string
  nodes: ModelNodes
}
