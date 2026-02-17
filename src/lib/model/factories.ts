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

export function createRule(
  inputCount: number,
  outputCount: number
): DecisionTableRule {
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

// ─── Clone ──────────────────────────────────────────────────────

export function cloneContent(content: NodeContent): NodeContent {
  switch (content.type) {
    case 'input':
      return { type: 'input', id: generateId('input') }
    case 'constant':
      return { ...content }
    case 'context':
      return {
        ...content,
        entries: content.entries.map((e) => ({
          ...e,
          id: generateId('ce'),
          expression: { ...e.expression },
        })),
      }
    case 'decisionTable':
      return {
        ...content,
        inputClauses: content.inputClauses.map((c) => ({
          ...c,
          id: generateId('ic'),
        })),
        outputClauses: content.outputClauses.map((c) => ({
          ...c,
          id: generateId('oc'),
        })),
        rules: content.rules.map((r) => ({
          ...r,
          id: generateId('rule'),
          inputEntries: [...r.inputEntries],
          outputEntries: [...r.outputEntries],
          annotationEntries: [...r.annotationEntries],
        })),
      }
  }
}

export function uniqueName(
  baseName: string,
  existingNames: Set<string>
): string {
  let candidate = `${baseName}_copy`
  let i = 2
  while (existingNames.has(candidate)) {
    candidate = `${baseName}_copy_${i}`
    i++
  }
  return candidate
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
