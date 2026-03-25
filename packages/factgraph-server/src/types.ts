// Shared types — mirrors frontend src/lib/model/types.ts and nodes.ts
// Eventually these should live in a shared package; for now we duplicate.

export type RuleFormat = 'rac' | 'factGraph'

// Matches the actual XML element names from Direct File
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

export type Limit = {
  type: 'Min' | 'Max' | 'MinLength' | 'MaxLength' | 'Match' | 'Contains' | 'MaxCollectionSize'
  value: string | number
}

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
  computation?: string
}

export type NodeContent = FactGraphWritable | FactGraphDerived

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

export type RulesetSummary = {
  id: string
  name: string
  format: RuleFormat
}
