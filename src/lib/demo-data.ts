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
      name: 'Applicant_Age',
      typeRef: 'number',
      dependencies: [],
      content: { type: 'input', id: generateId('input') },
    },
    [idB]: {
      id: idB,
      name: 'Annual_Income',
      typeRef: 'number',
      dependencies: [],
      content: { type: 'input', id: generateId('input') },
    },
    [idC]: {
      id: idC,
      name: 'Employment_Status',
      typeRef: 'string',
      dependencies: [],
      content: { type: 'input', id: generateId('input') },
    },

    // ─── Constants ────────────────────────────────────────────
    [idMinIncomeEmployed]: {
      id: idMinIncomeEmployed,
      name: 'Min_Income_Employed',
      typeRef: 'number',
      dependencies: [],
      content: { type: 'constant', text: '30000', typeRef: 'number' },
    },
    [idMinIncomeSelfEmployed]: {
      id: idMinIncomeSelfEmployed,
      name: 'Min_Income_Self_Employed',
      typeRef: 'number',
      dependencies: [],
      content: { type: 'constant', text: '20000', typeRef: 'number' },
    },
    [idMinAge]: {
      id: idMinAge,
      name: 'Min_Age',
      typeRef: 'number',
      dependencies: [],
      content: { type: 'constant', text: '18', typeRef: 'number' },
    },
    [idMaxAge]: {
      id: idMaxAge,
      name: 'Max_Age',
      typeRef: 'number',
      dependencies: [],
      content: { type: 'constant', text: '65', typeRef: 'number' },
    },

    // ─── Decision Tables ──────────────────────────────────────
    [idD]: {
      id: idD,
      name: 'Income_Threshold',
      typeRef: 'boolean',
      dependencies: [idB, idC, idMinIncomeEmployed, idMinIncomeSelfEmployed],
      content: {
        type: 'decisionTable',
        hitPolicy: 'FIRST',
        inputClauses: [
          {
            id: generateId('ic'),
            label: 'Annual_Income',
            inputExpression: 'Annual_Income',
            inputExpressionTypeRef: 'number',
          },
          {
            id: generateId('ic'),
            label: 'Employment_Status',
            inputExpression: 'Employment_Status',
            inputExpressionTypeRef: 'string',
          },
        ],
        outputClauses: [
          {
            id: generateId('oc'),
            label: 'Income_Eligible',
            name: 'Income_Eligible',
            typeRef: 'boolean',
          },
        ],
        rules: [
          {
            id: generateId('rule'),
            inputEntries: ['>= Min_Income_Employed', '"employed"'],
            outputEntries: ['true'],
            annotationEntries: [],
          },
          {
            id: generateId('rule'),
            inputEntries: ['>= Min_Income_Self_Employed', '"self-employed"'],
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
      name: 'Age_Eligibility',
      typeRef: 'boolean',
      dependencies: [idA, idMinAge, idMaxAge],
      content: {
        type: 'decisionTable',
        hitPolicy: 'UNIQUE',
        inputClauses: [
          {
            id: generateId('ic'),
            label: 'Applicant_Age',
            inputExpression: 'Applicant_Age',
            inputExpressionTypeRef: 'number',
          },
        ],
        outputClauses: [
          {
            id: generateId('oc'),
            label: 'Age_Eligible',
            name: 'Age_Eligible',
            typeRef: 'boolean',
          },
        ],
        rules: [
          {
            id: generateId('rule'),
            inputEntries: ['[Min_Age..Max_Age]'],
            outputEntries: ['true'],
            annotationEntries: [],
          },
          {
            id: generateId('rule'),
            inputEntries: ['< Min_Age'],
            outputEntries: ['false'],
            annotationEntries: [],
          },
          {
            id: generateId('rule'),
            inputEntries: ['> Max_Age'],
            outputEntries: ['false'],
            annotationEntries: [],
          },
        ],
      },
    },

    // ─── Context ──────────────────────────────────────────────
    [idF]: {
      id: idF,
      name: 'Eligibility_Factors',
      typeRef: 'boolean',
      dependencies: [idD, idE],
      content: {
        type: 'context',
        entries: [
          {
            id: generateId('ce'),
            name: 'Income_Check',
            expression: { text: 'Income_Threshold', typeRef: 'boolean' },
          },
          {
            id: generateId('ce'),
            name: 'Age_Check',
            expression: { text: 'Age_Eligibility', typeRef: 'boolean' },
          },
          {
            id: generateId('ce'),
            name: '_return',
            expression: { text: 'Income_Check and Age_Check' },
          },
        ],
      },
    },

    // ─── Final Decision ───────────────────────────────────────
    [idG]: {
      id: idG,
      name: 'Final_Recommendation',
      typeRef: 'string',
      dependencies: [idF],
      content: {
        type: 'context',
        entries: [
          {
            id: generateId('ce'),
            name: '_return',
            expression: {
              text: 'if Eligibility_Factors then "Approved" else "Denied"',
            },
          },
        ],
      },
    },
  }

  const model: Model = {
    id: generateId('model'),
    name: 'Benefits_Eligibility',
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
