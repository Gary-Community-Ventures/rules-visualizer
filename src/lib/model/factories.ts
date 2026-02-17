import type {
  ContextEntry,
  FeelDataType,
  InputClause,
  OutputClause,
  DecisionTableRule,
} from './types'
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
  return { type: 'input', id: generateId('input') }
}

export const RETURN_NAME = '_return'

export function createEntry(name = '', text = ''): ContextEntry {
  return {
    id: generateId(),
    name,
    expression: { text },
  }
}

export function createDefaultContext(): Context {
  return {
    type: 'context',
    entries: [createEntry(RETURN_NAME)],
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

export function createInputClause(): InputClause {
  return {
    id: generateId('input'),
    label: '',
    inputExpression: '',
  }
}

export function createOutputClause(): OutputClause {
  return {
    id: generateId('output'),
    label: '',
    name: '',
  }
}

export function createRule(inputCount: number, outputCount: number): DecisionTableRule {
  return {
    id: generateId('rule'),
    inputEntries: Array(inputCount).fill('-'),
    outputEntries: Array(outputCount).fill(''),
    annotationEntries: [],
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
