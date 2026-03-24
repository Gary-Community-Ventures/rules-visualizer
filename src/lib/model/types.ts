// Generic data type (shared across formats)
export type DataType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'currency'
  | 'unknown'

// Rule format identifier
export type RuleFormat = 'rac' | 'factGraph'
