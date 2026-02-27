import type {
  ContextEntry,
  InputClause,
  OutputClause,
  DecisionTableRule,
  FeelExpression,
} from './types'
import type {
  ModelNode,
  NodeContent,
  Input,
  Context,
  Constant,
  DecisionTable,
  NodeTestCase,
  IntegrationTestCase,
  NodeLink,
} from './nodes'

// ─── Content Helpers ──────────────────────────────────────────────

/** Get tests from node content (only Context and DecisionTable have tests) */
export function getNodeTests(node: ModelNode): NodeTestCase[] {
  const content = node.content
  if (content.type === 'context' || content.type === 'decisionTable') {
    return content.tests ?? []
  }
  return []
}

export function generateId(): string {
  return crypto.randomUUID()
}

export const RETURN_NAME = '_return'

// ─── Content Factories ───────────────────────────────────────────

export function createInput(partial: Partial<Input> = {}): Input {
  return {
    type: 'input',
    id: generateId(),
    defaultValue: '',
    ...partial,
  }
}

export function createExpression(
  partial: Partial<FeelExpression> = {}
): FeelExpression {
  return {
    text: '',
    ...partial,
  }
}

export function createEntry(partial: Partial<ContextEntry> = {}): ContextEntry {
  return {
    id: generateId(),
    name: '',
    expression: createExpression(partial.expression),
    ...partial,
  }
}

export function createContext(partial: Partial<Context> = {}): Context {
  return {
    type: 'context',
    entries: [createEntry({ name: RETURN_NAME })],
    tests: [],
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

export function createInputClause(
  partial: Partial<InputClause> = {}
): InputClause {
  return {
    id: generateId(),
    inputExpression: '',
    ...partial,
  }
}

export function createOutputClause(
  partial: Partial<OutputClause> = {}
): OutputClause {
  return {
    id: generateId(),
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
    id: generateId(),
    inputEntries: Array(inputCount).fill('-'),
    outputEntries: Array(outputCount).fill(''),
    annotationEntries: [],
    ...partial,
  }
}

export function createDecisionTable(
  partial: Partial<DecisionTable> = {}
): DecisionTable {
  return {
    type: 'decisionTable',
    hitPolicy: 'UNIQUE',
    inputClauses: [],
    outputClauses: [],
    rules: [],
    tests: [],
    ...partial,
  }
}

export function createTestCase(
  partial: Partial<NodeTestCase> = {}
): NodeTestCase {
  return {
    id: generateId(),
    name: '',
    inputs: {},
    expected: '',
    ...partial,
  }
}

export function createIntegrationTestCase(
  partial: Partial<IntegrationTestCase> = {}
): IntegrationTestCase {
  return {
    id: generateId(),
    name: '',
    inputs: {},
    assertions: {},
    ...partial,
  }
}

export function createLink(partial: Partial<NodeLink> = {}): NodeLink {
  return { id: generateId(), label: '', url: '', ...partial }
}

// ─── Clone ──────────────────────────────────────────────────────

export function cloneContent(content: NodeContent): NodeContent {
  switch (content.type) {
    case 'input':
      return {
        type: 'input',
        id: generateId(),
        defaultValue: content.defaultValue,
      }
    case 'constant':
      return { ...content }
    case 'context':
      return {
        ...content,
        entries: content.entries.map((e) => ({
          ...e,
          id: generateId(),
          expression: { ...e.expression },
        })),
      }
    case 'decisionTable':
      return {
        ...content,
        inputClauses: content.inputClauses.map((c) => ({
          ...c,
          id: generateId(),
        })),
        outputClauses: content.outputClauses.map((c) => ({
          ...c,
          id: generateId(),
        })),
        rules: content.rules.map((r) => ({
          ...r,
          id: generateId(),
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
    id: generateId(),
    name: '',
    dependencies: [],
    content: createContext(),
    ...partial,
  }
}
