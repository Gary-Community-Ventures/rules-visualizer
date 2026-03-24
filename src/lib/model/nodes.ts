import type { DataType, RuleFormat } from './types'

// --- RAC content types ---

type RacVariable = {
  format: 'rac'
  type: 'variable'
  path: string
  dataType: DataType
  expression?: string
  source?: string
  temporalValues?: { from: string; to?: string; expression: string }[]
}

type RacEntity = {
  format: 'rac'
  type: 'entity'
  fields: { name: string; dataType: DataType }[]
}

// --- Fact Graph content types ---

type FactGraphWritable = {
  format: 'factGraph'
  type: 'writable'
  path: string
  dataType: DataType
}

type FactGraphDerived = {
  format: 'factGraph'
  type: 'derived'
  path: string
  dataType: DataType
  computation?: string
}

export type NodeContent =
  | RacVariable
  | RacEntity
  | FactGraphWritable
  | FactGraphDerived

// Node & Model

export type ModelNode = {
  id: string
  name: string
  dependencies: string[]
  content: NodeContent
  description?: string
  tags?: string[]
}

export type ModelNodes = Record<string, ModelNode>

export type Model = {
  id: string
  name: string
  format: RuleFormat
  nodes: ModelNodes
}
