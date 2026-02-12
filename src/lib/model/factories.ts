import type { FeelDataType } from './types'
import type {
  ModelNode,
  NodeContent,
  Input,
  Context,
  Constant,
  DecisionTable,
} from './nodes'

export function generateId(prefix?: string): string {
  const uuid = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  return prefix ? `_${prefix}_${uuid}` : `_${uuid}`
}

// ─── Content Factories ───────────────────────────────────────────

export function createInput(): Input {
  return { type: 'input' }
}

export const RETURN_NAME = '_return'

export function createDefaultContext(): Context {
  return {
    type: 'context',
    id: generateId('ctx'),
    entries: [
      {
        id: generateId(),
        name: RETURN_NAME,
        expression: { text: '' },
      },
    ],
  }
}

export function createDefaultConstant(
  text: string,
  typeRef?: FeelDataType
): Constant {
  return {
    type: 'constant',
    text,
    typeRef,
  }
}

export function createDefaultDecisionTable(): DecisionTable {
  return {
    type: 'decisionTable',
    hitPolicy: 'UNIQUE',
    inputClauses: [],
    outputClauses: [],
    rules: [],
  }
}

// ─── Node Factory ────────────────────────────────────────────────

export function createNode(
  id: string,
  name: string,
  content?: NodeContent
): ModelNode {
  return {
    id,
    name,
    dependencies: [],
    content: content ?? createDefaultContext(),
  }
}
