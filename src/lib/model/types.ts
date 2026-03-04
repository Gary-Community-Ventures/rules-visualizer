// ─── FEEL Data Types ─────────────────────────────────────────────

export type FeelDataType =
  | 'number'
  | 'string'
  | 'boolean'
  | 'date'
  | 'time'
  | 'dateTime'
  | 'dayTimeDuration'
  | 'yearMonthDuration'

export const FEEL_DATA_TYPES: FeelDataType[] = [
  'number',
  'string',
  'boolean',
  'date',
  'time',
  'dateTime',
  'dayTimeDuration',
  'yearMonthDuration',
]

// ─── Custom Types ───────────────────────────────────────────────

export type CustomTypeField = { name: string; typeRef: string }

export type CustomType = {
  id: string
  name: string
  fields: CustomTypeField[]
}

// ─── Context Entry ───────────────────────────────────────────────

export type FeelExpression = {
  text: string
  typeRef?: string
}

export type ContextEntry = {
  id: string
  name: string
  expression: FeelExpression
}

// ─── Decision Table Sub-Types ────────────────────────────────────

export type HitPolicy =
  | 'UNIQUE'
  | 'ANY'
  | 'PRIORITY'
  | 'FIRST'
  | 'OUTPUT ORDER'
  | 'RULE ORDER'
  | 'COLLECT'

export type Aggregation = 'SUM' | 'COUNT' | 'MIN' | 'MAX'

export type InputClause = {
  id: string
  inputExpression: string // FEEL expression evaluated against input
  inputExpressionTypeRef?: string
}

export type OutputClause = {
  id: string
  name: string
  typeRef?: string
}

export type DecisionTableRule = {
  id: string
  inputEntries: string[] // unary test FEEL expressions, one per input clause
  outputEntries: string[] // FEEL expressions, one per output clause
  annotationEntries: string[]
}
