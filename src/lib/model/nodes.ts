import type { FeelDataType, Expression } from './expressions'

// ─── Node Types ─────────────────────────────────────────────────

export type InputNode = {
  type: 'inputData'
  id: string
  name: string
  typeRef?: FeelDataType
}

export type DecisionNode = {
  type: 'decision'
  id: string
  name: string
  typeRef?: FeelDataType
  expression: Expression
  dependencies: string[] // IDs of InputNode or DecisionNode this depends on
  isConstant: boolean // editor-only, not exported to DMN XML
}

export type ModelNode = InputNode | DecisionNode

// ─── Top-Level Model ─────────────────────────────────────────────

export type Model = {
  id: string
  name: string
  namespace: string
  nodes: Record<string, ModelNode>
}

// ─── Type Guards ─────────────────────────────────────────────────

export function isInputData(node: ModelNode): node is InputNode {
  return node.type === 'inputData'
}

export function isDecision(node: ModelNode): node is DecisionNode {
  return node.type === 'decision'
}
