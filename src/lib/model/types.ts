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

// ─── Context Entry ───────────────────────────────────────────────

export type ContextEntry = {
  id: string
  name: string
  expression: {
    text: string
    typeRef?: FeelDataType
  }
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
  label: string
  inputExpression: string // FEEL expression evaluated against input
  inputExpressionTypeRef?: FeelDataType
}

export type OutputClause = {
  id: string
  label: string
  name: string
  typeRef?: FeelDataType
}

export type DecisionTableRule = {
  id: string
  inputEntries: string[] // unary test FEEL expressions, one per input clause
  outputEntries: string[] // FEEL expressions, one per output clause
  annotationEntries: string[]
}
