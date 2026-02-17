import type { Model, ModelNode, ModelNodes } from './model'
import { generateId } from './model'

type DemoData = {
  model: Model
  diffs: ModelNode[]
}

export function createDemoModel(): DemoData {
  // Use stable IDs so localStorage showChildren state persists across reloads
  const idA = '_node_applicant_age'
  const idB = '_node_annual_income'
  const idC = '_node_employment_status'
  const idD = '_node_income_threshold'
  const idE = '_node_age_eligibility'
  const idF = '_node_eligibility_factors'
  const idG = '_node_final_recommendation'
  // Constants
  const idMinIncomeEmployed = '_node_min_income_employed'
  const idMinIncomeSelfEmployed = '_node_min_income_self_employed'
  const idMinAge = '_node_min_age'
  const idMaxAge = '_node_max_age'

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
      dependencies: [],
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
      dependencies: [],
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
      dependencies: [],
      content: {
        type: 'context',
        entries: [
          {
            id: '_ce_income_check',
            name: 'Income_Check',
            expression: { text: 'Income_Threshold', typeRef: 'boolean' },
          },
          {
            id: '_ce_age_check',
            name: 'Age_Check',
            expression: { text: 'Age_Eligibility', typeRef: 'boolean' },
          },
          {
            id: '_ce_return',
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
      dependencies: [],
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
  const eligibilityNode = nodes[idF]
  const diffs: ModelNode[] = [
    {
      ...minIncomeNode,
      content: { type: 'constant', text: '35000', typeRef: 'number' },
    },
    {
      ...eligibilityNode,
      content: {
        type: 'context',
        entries: [
          // Modified: changed name and expression
          {
            id: '_ce_income_check',
            name: 'Income_Eligible',
            expression: { text: 'Income_Threshold = true', typeRef: 'boolean' },
          },
          // Removed: Age_Check (not included)
          // Added: new entry
          {
            id: '_ce_credit_check',
            name: 'Credit_Check',
            expression: { text: 'Credit_Score > 650' },
          },
          // Modified: updated return expression
          {
            id: '_ce_return',
            name: '_return',
            expression: { text: 'Income_Eligible and Credit_Check' },
          },
        ],
      },
    },
  ]

  return { model, diffs }
}
