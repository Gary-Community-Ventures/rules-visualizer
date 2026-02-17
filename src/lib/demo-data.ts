import type { Model, ModelNode, ModelNodes } from './model'
import { generateId } from './model'

type DemoData = {
  model: Model
  diffs: ModelNode[]
}

export function createDemoModel(): DemoData {
  // Generate stable IDs
  const idA = generateId('node')
  const idB = generateId('node')
  const idC = generateId('node')
  const idD = generateId('node')
  const idE = generateId('node')
  const idF = generateId('node')
  const idG = generateId('node')
  // Constants
  const idMinIncomeEmployed = generateId('node')
  const idMinIncomeSelfEmployed = generateId('node')
  const idMinAge = generateId('node')
  const idMaxAge = generateId('node')

  const nodes: ModelNodes = {
    // ─── Inputs ───────────────────────────────────────────────
    [idA]: {
      id: idA,
      name: 'Applicant Age',
      typeRef: 'number',
      dependencies: [],
      content: { type: 'input', id: generateId('input') },
    },
    [idB]: {
      id: idB,
      name: 'Annual Income',
      typeRef: 'number',
      dependencies: [],
      content: { type: 'input', id: generateId('input') },
    },
    [idC]: {
      id: idC,
      name: 'Employment Status',
      typeRef: 'string',
      dependencies: [],
      content: { type: 'input', id: generateId('input') },
    },

    // ─── Constants ────────────────────────────────────────────
    [idMinIncomeEmployed]: {
      id: idMinIncomeEmployed,
      name: 'Min Income Employed',
      typeRef: 'number',
      dependencies: [],
      content: { type: 'constant', text: '30000', typeRef: 'number' },
    },
    [idMinIncomeSelfEmployed]: {
      id: idMinIncomeSelfEmployed,
      name: 'Min Income Self Employed',
      typeRef: 'number',
      dependencies: [],
      content: { type: 'constant', text: '20000', typeRef: 'number' },
    },
    [idMinAge]: {
      id: idMinAge,
      name: 'Min Age',
      typeRef: 'number',
      dependencies: [],
      content: { type: 'constant', text: '18', typeRef: 'number' },
    },
    [idMaxAge]: {
      id: idMaxAge,
      name: 'Max Age',
      typeRef: 'number',
      dependencies: [],
      content: { type: 'constant', text: '65', typeRef: 'number' },
    },

    // ─── Decision Tables ──────────────────────────────────────
    [idD]: {
      id: idD,
      name: 'Income Threshold',
      typeRef: 'boolean',
      dependencies: [idB, idC, idMinIncomeEmployed, idMinIncomeSelfEmployed],
      content: {
        type: 'decisionTable',
        hitPolicy: 'FIRST',
        inputClauses: [
          {
            id: generateId('ic'),
            label: 'Annual Income',
            inputExpression: 'Annual Income',
            inputExpressionTypeRef: 'number',
          },
          {
            id: generateId('ic'),
            label: 'Employment Status',
            inputExpression: 'Employment Status',
            inputExpressionTypeRef: 'string',
          },
        ],
        outputClauses: [
          {
            id: generateId('oc'),
            label: 'Income Eligible',
            name: 'Income Eligible',
            typeRef: 'boolean',
          },
        ],
        rules: [
          {
            id: generateId('rule'),
            inputEntries: ['>= Min Income Employed', '"employed"'],
            outputEntries: ['true'],
            annotationEntries: [],
          },
          {
            id: generateId('rule'),
            inputEntries: ['>= Min Income Self Employed', '"self-employed"'],
            outputEntries: ['true'],
            annotationEntries: [],
          },
          {
            id: generateId('rule'),
            inputEntries: ['-', '-'],
            outputEntries: ['false'],
            annotationEntries: [],
          },
        ],
      },
    },
    [idE]: {
      id: idE,
      name: 'Age Eligibility',
      typeRef: 'boolean',
      dependencies: [idA, idMinAge, idMaxAge],
      content: {
        type: 'decisionTable',
        hitPolicy: 'UNIQUE',
        inputClauses: [
          {
            id: generateId('ic'),
            label: 'Applicant Age',
            inputExpression: 'Applicant Age',
            inputExpressionTypeRef: 'number',
          },
        ],
        outputClauses: [
          {
            id: generateId('oc'),
            label: 'Age Eligible',
            name: 'Age Eligible',
            typeRef: 'boolean',
          },
        ],
        rules: [
          {
            id: generateId('rule'),
            inputEntries: ['[Min Age..Max Age]'],
            outputEntries: ['true'],
            annotationEntries: [],
          },
          {
            id: generateId('rule'),
            inputEntries: ['< Min Age'],
            outputEntries: ['false'],
            annotationEntries: [],
          },
          {
            id: generateId('rule'),
            inputEntries: ['> Max Age'],
            outputEntries: ['false'],
            annotationEntries: [],
          },
        ],
      },
    },

    // ─── Context ──────────────────────────────────────────────
    [idF]: {
      id: idF,
      name: 'Eligibility Factors',
      typeRef: 'boolean',
      dependencies: [idD, idE],
      content: {
        type: 'context',
        entries: [
          {
            id: generateId('ce'),
            name: 'Income Check',
            expression: { text: 'Income Threshold', typeRef: 'boolean' },
          },
          {
            id: generateId('ce'),
            name: 'Age Check',
            expression: { text: 'Age Eligibility', typeRef: 'boolean' },
          },
          {
            id: generateId('ce'),
            name: '_return',
            expression: { text: 'Income Check and Age Check' },
          },
        ],
      },
    },

    // ─── Final Decision ───────────────────────────────────────
    [idG]: {
      id: idG,
      name: 'Final Recommendation',
      typeRef: 'string',
      dependencies: [idF],
      content: {
        type: 'context',
        entries: [
          {
            id: generateId('ce'),
            name: '_return',
            expression: {
              text: 'if Eligibility Factors then "Approved" else "Denied"',
            },
          },
        ],
      },
    },
  }

  const model: Model = {
    id: generateId('model'),
    name: 'Benefits Eligibility',
    namespace: 'https://example.com/benefits-eligibility',
    nodes,
  }

  const finalNode = nodes[idG]
  const minIncomeNode = nodes[idMinIncomeEmployed]
  const diffs: ModelNode[] = [
    { ...finalNode, name: finalNode.name + ' (modified)' },
    {
      ...minIncomeNode,
      content: { type: 'constant', text: '35000', typeRef: 'number' },
    },
  ]

  return { model, diffs }
}
