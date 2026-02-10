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

// ─── Literal Expression ──────────────────────────────────────────

export type LiteralExpression = {
  id: string
  type: 'literalExpression'
  text: string
  typeRef?: FeelDataType
}

// ─── Decision Table ──────────────────────────────────────────────

export type HitPolicy =
  | 'UNIQUE'
  | 'ANY'
  | 'PRIORITY'
  | 'FIRST'
  | 'OUTPUT ORDER'
  | 'RULE ORDER'
  | 'COLLECT'

export type Aggregation = 'SUM' | 'COUNT' | 'MIN' | 'MAX' | 'NONE'

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

export type DecisionTable = {
  id: string
  type: 'decisionTable'
  hitPolicy: HitPolicy
  aggregation?: Aggregation // only valid when hitPolicy is COLLECT
  inputClauses: InputClause[]
  outputClauses: OutputClause[]
  rules: DecisionTableRule[]
}

// ─── Context Expression ──────────────────────────────────────────

export type ContextEntry = {
  id: string
  name: string
  expression: LiteralExpression // restricted to LiteralExpression for now
}

export type ContextExpression = {
  id: string
  type: 'context'
  entries: ContextEntry[]
  // Convention: entry named '_return' is the final result
}

// ─── Expression Union ────────────────────────────────────────────

export type Expression = LiteralExpression | DecisionTable | ContextExpression
