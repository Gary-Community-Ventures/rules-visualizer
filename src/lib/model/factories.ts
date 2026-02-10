import type { FeelDataType, DecisionTable } from './expressions'
import type { DecisionNode, InputNode } from './nodes'

export function generateId(prefix?: string): string {
  const uuid = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  return prefix ? `_${prefix}_${uuid}` : `_${uuid}`
}

export function createDefaultDecisionTable(): DecisionTable {
  return {
    id: generateId('dt'),
    type: 'decisionTable',
    hitPolicy: 'UNIQUE',
    inputClauses: [],
    outputClauses: [],
    rules: [],
  }
}

export function createDefaultDecision(id: string, name: string): DecisionNode {
  return {
    type: 'decision',
    id,
    name,
    expression: {
      id: generateId('ctx'),
      type: 'context',
      entries: [],
    },
    dependencies: [],
    isConstant: false,
  }
}

export function createConstantDecision(
  id: string,
  name: string,
  feelText: string,
  typeRef?: FeelDataType
): DecisionNode {
  return {
    type: 'decision',
    id,
    name,
    typeRef,
    expression: {
      id: generateId('le'),
      type: 'literalExpression',
      text: feelText,
      typeRef,
    },
    dependencies: [],
    isConstant: true,
  }
}

export function createDefaultInputData(id: string, name: string): InputNode {
  return {
    type: 'inputData',
    id,
    name,
  }
}
