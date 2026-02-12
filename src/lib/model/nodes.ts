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

export type Input = { type: 'input', id: string }

export type Constant = {
  type: 'constant'
  id: string
  text: string
  typeRef?: FeelDataType
}

export type Context = {
  type: 'context'
  id: string
  entries: ContextEntry[]
  // Convention: entry named '_return' is the final result
}

export type DecisionTable = {
  type: 'decisionTable'
  id: string
  hitPolicy: HitPolicy
  aggregation?: Aggregation
  inputClauses: InputClause[]
  outputClauses: OutputClause[]
  rules: DecisionTableRule[]
}

export type NodeContent = Input | Constant | Context | DecisionTable

// ─── Node & Model ────────────────────────────────────────────────

export type ModelNode = {
  id: string
  name: string
  typeRef?: FeelDataType
  dependencies: string[]
  content: NodeContent
}

export type ModelNodes = Record<string, ModelNode>

export type Model = {
  id: string
  name: string
  namespace: string
  nodes: ModelNodes
}
