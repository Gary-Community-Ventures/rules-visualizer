import type { Model, ModelNodes } from './model'
import { generateId } from './model'

export function createDemoModel(): Model {
  // Generate stable IDs
  const idA = generateId('node')
  const idB = generateId('node')
  const idC = generateId('node')
  const idD = generateId('node')
  const idE = generateId('node')
  const idF = generateId('node')
  const idG = generateId('node')

  const nodes: ModelNodes = {
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
    [idD]: {
      id: idD,
      name: 'Income Threshold',
      typeRef: 'boolean',
      dependencies: [idB, idC],
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
            inputEntries: ['>= 30000', '"employed"'],
            outputEntries: ['true'],
            annotationEntries: [],
          },
          {
            id: generateId('rule'),
            inputEntries: ['>= 20000', '"self-employed"'],
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
      dependencies: [idA],
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
            inputEntries: ['[18..65]'],
            outputEntries: ['true'],
            annotationEntries: [],
          },
          {
            id: generateId('rule'),
            inputEntries: ['< 18'],
            outputEntries: ['false'],
            annotationEntries: [],
          },
          {
            id: generateId('rule'),
            inputEntries: ['> 65'],
            outputEntries: ['false'],
            annotationEntries: [],
          },
        ],
      },
    },
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
    [idG]: {
      id: idG,
      name: 'Final Recommendation',
      typeRef: 'string',
      dependencies: [idF],
      content: {
        type: 'constant',
        text: 'if Eligibility Factors then "Approved" else "Denied"',
        typeRef: 'string',
      },
    },
  }

  return {
    id: generateId('model'),
    name: 'Benefits Eligibility',
    namespace: 'https://example.com/benefits-eligibility',
    nodes,
  }
}
