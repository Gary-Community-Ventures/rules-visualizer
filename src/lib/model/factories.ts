import type {
  ContextEntry,
  InputClause,
  OutputClause,
  DecisionTableRule,
  FeelExpression,
} from './types'
import type {
  ModelNode,
  Input,
  Context,
  Constant,
  DecisionTable,
} from './nodes'

export function generateId(prefix?: string): string {
  const uuid = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  return prefix ? `_${prefix}_${uuid}` : `_${uuid}`
}

export const RETURN_NAME = '_return'

// ─── Content Factories ───────────────────────────────────────────

export function createInput(partial: Partial<Input> = {}): Input {
  return {
    type: 'input',
    id: generateId('input'),
    ...partial,
  }
}

export function createExpression(partial: Partial<FeelExpression> = {}): FeelExpression {
  return {
    text: '',
    ...partial,
  }
}

export function createEntry(partial: Partial<ContextEntry> = {}): ContextEntry {
  return {
    id: generateId('entry'),
    name: '',
    expression: createExpression(partial.expression),
    ...partial,
  }
}

export function createContext(partial: Partial<Context> = {}): Context {
  return {
    type: 'context',
    entries: [createEntry({ name: RETURN_NAME })],
    ...partial,
  }
}

export function createConstant(partial: Partial<Constant> = {}): Constant {
  return {
    type: 'constant',
    text: '',
    ...partial,
  }
}

export function createInputClause(partial: Partial<InputClause> = {}): InputClause {
  return {
    id: generateId('input'),
    label: '',
    inputExpression: '',
    ...partial,
  }
}

export function createOutputClause(partial: Partial<OutputClause> = {}): OutputClause {
  return {
    id: generateId('output'),
    label: '',
    name: '',
    ...partial,
  }
}

export function createRule(
  inputCount: number,
  outputCount: number,
  partial: Partial<DecisionTableRule> = {}
): DecisionTableRule {
  return {
    id: generateId('rule'),
    inputEntries: Array(inputCount).fill('-'),
    outputEntries: Array(outputCount).fill(''),
    annotationEntries: [],
    ...partial,
  }
}

export function createDecisionTable(partial: Partial<DecisionTable> = {}): DecisionTable {
  return {
    type: 'decisionTable',
    hitPolicy: 'UNIQUE',
    inputClauses: [],
    outputClauses: [],
    rules: [],
    ...partial,
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

export function createNode(partial: Partial<ModelNode> = {}): ModelNode {
  return {
    id: generateId('node'),
    name: '',
    dependencies: [],
    content: createContext(),
    ...partial,
  }
}
