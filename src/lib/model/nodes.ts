import type {
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
}

export type Context = {
  type: 'context'
  entries: ContextEntry[]
  tests: NodeTestCase[]
  // Convention: entry named '_return' is the final result
}

export type DecisionTable = {
  type: 'decisionTable'
  hitPolicy: HitPolicy
  aggregation?: Aggregation
  inputClauses: InputClause[]
  outputClauses: OutputClause[]
  rules: DecisionTableRule[]
  tests: NodeTestCase[]
}

export type NodeContent = Input | Constant | Context | DecisionTable

// ─── Test Cases ─────────────────────────────────────────────────

export type NodeTestCase = {
  id: string
  name: string
  inputs: Record<string, unknown>
  expected: string
}

export type IntegrationTestCase = {
  id: string
  name: string
  inputs: Record<string, unknown> // input node ID → value
  assertions: Record<string, string> // node ID → expected value (string)
}

// ─── Documentation ───────────────────────────────────────────────

export type NodeLink = {
  id: string
  label: string
  url: string
}

// ─── Node & Model ────────────────────────────────────────────────

export type ModelNode = {
  id: string
  name: string
  typeRef?: string
  dependencies: string[]
  content: NodeContent
  description?: string
  links?: NodeLink[]
  deletedVersion?: string
}

export type ModelNodes = Record<string, ModelNode>

export type Model = {
  id: string
  name: string
  namespace: string
  nodes: ModelNodes
  integrationTests?: IntegrationTestCase[]
}
