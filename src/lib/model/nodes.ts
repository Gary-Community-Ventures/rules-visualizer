import type { RuleFormat, WritableTypeName, Limit } from './types'

// --- RAC content types (mirrors RAC AST/IR) ---

export type RacVariable = {
  format: 'rac'
  type: 'variable'
  path: string
  entity?: string
  label?: string
  unit?: string
  default?: string
  expression?: string // human-readable for now, will become AST
  source?: string
  temporalValues?: { from: string; to?: string; expression: string }[]
}

export type RacEntityField = {
  name: string
  dtype: string // native RAC type string (e.g. "str", "int", "date", "money")
  nullable?: boolean
  default?: string
}

export type RacForeignKey = {
  field: string
  target: string
}

export type RacEntity = {
  format: 'rac'
  type: 'entity'
  fields: RacEntityField[]
  foreignKeys?: RacForeignKey[]
  reverseRelations?: { name: string; entity: string; field: string }[]
}

// --- Fact Graph content types (mirrors Fact Graph XML/config) ---

export type FactGraphWritable = {
  format: 'factGraph'
  type: 'writable'
  path: string
  typeName: WritableTypeName
  enumOptions?: string[]
  limits?: Limit[]
  collectionItemAlias?: string
}

export type FactGraphDerived = {
  format: 'factGraph'
  type: 'derived'
  path: string
  computation?: string // human-readable for now, will become expression tree
  complete?: boolean
}

export type NodeContent =
  | RacVariable
  | RacEntity
  | FactGraphWritable
  | FactGraphDerived

// --- Shared graph shell (format-agnostic) ---

export type ModelNode = {
  id: string
  name: string
  dependencies: string[] // pre-computed by backend/converter
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
