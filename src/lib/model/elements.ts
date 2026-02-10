import type { FeelDataType, Expression } from './expressions'

// ─── Element Types ───────────────────────────────────────────────

export type InputDataElement = {
  type: 'inputData'
  id: string
  name: string
  typeRef?: FeelDataType
}

export type DecisionElement = {
  type: 'decision'
  id: string
  name: string
  typeRef?: FeelDataType
  expression: Expression
  dependencies: string[] // IDs of InputData or Decision elements this depends on
  isConstant: boolean // editor-only, not exported to DMN XML
}

export type ModelElement = InputDataElement | DecisionElement

// ─── Top-Level Model ─────────────────────────────────────────────

export type Model = {
  id: string
  name: string
  namespace: string
  elements: Record<string, ModelElement>
}

// ─── Type Guards ─────────────────────────────────────────────────

export function isInputData(el: ModelElement): el is InputDataElement {
  return el.type === 'inputData'
}

export function isDecision(el: ModelElement): el is DecisionElement {
  return el.type === 'decision'
}
