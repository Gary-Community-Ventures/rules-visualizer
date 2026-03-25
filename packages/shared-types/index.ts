// Shared types for the rules-visualizer monorepo.
// This is the single source of truth — frontend and factgraph-server re-export from here.

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Rule format identifier */
export type RuleFormat = 'rac' | 'factGraph'

/** Fact Graph writable type names — matches Direct File XML element names */
export type WritableTypeName =
  | 'String'
  | 'Boolean'
  | 'Dollar'
  | 'Int'
  | 'Short'
  | 'Byte'
  | 'Rational'
  | 'Day'
  | 'Enum'
  | 'MultiEnum'
  | 'Collection'
  | 'CollectionItem'
  | 'Address'
  | 'BankAccount'
  | 'EmailAddress'
  | 'PhoneNumber'
  | 'TIN'
  | 'EIN'
  | 'PIN'
  | 'IPPIN'

/** Fact Graph validation limit — type names match Direct File XML */
export type Limit = {
  type: 'Min' | 'Max' | 'MinLength' | 'MaxLength' | 'Match' | 'Contains' | 'MaxCollectionSize'
  value: string | number
}

// ---------------------------------------------------------------------------
// RAC content types (mirrors RAC AST/IR)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fact Graph content types (mirrors Fact Graph XML/config)
// ---------------------------------------------------------------------------

export type FactGraphWritable = {
  format: 'factGraph'
  type: 'writable'
  path: string
  typeName: WritableTypeName
  enumOptionsPath?: string
  limits?: Limit[]
  collectionItemPath?: string
}

export type FactGraphDerived = {
  format: 'factGraph'
  type: 'derived'
  path: string
  computation?: string // human-readable serialization of the expression tree
}

// ---------------------------------------------------------------------------
// Node content union
// ---------------------------------------------------------------------------

export type NodeContent =
  | RacVariable
  | RacEntity
  | FactGraphWritable
  | FactGraphDerived

// ---------------------------------------------------------------------------
// Shared graph shell (format-agnostic)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

export type RulesetSummary = {
  id: string
  name: string
  format: RuleFormat
}
