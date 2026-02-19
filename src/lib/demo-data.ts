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
      content: { type: 'input', id: generateId('input'), defaultValue: '30' },
    },
    [idB]: {
      id: idB,
      name: 'Annual_Income',
      typeRef: 'number',
      dependencies: [],
      content: { type: 'input', id: generateId('input'), defaultValue: '50000' },
    },
    [idC]: {
      id: idC,
      name: 'Employment_Status',
      typeRef: 'string',
      dependencies: [],
      content: { type: 'input', id: generateId('input'), defaultValue: '"employed"' },
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

  const applicantAgeNode = nodes[idA]
  const minAgeNode = nodes[idMinAge]
  const maxAgeNode = nodes[idMaxAge]
  const eligibilityNode = nodes[idF]
  const ageEligibilityNode = nodes[idE]
  const finalRecommendationNode = nodes[idG]
  const idCreditScore = '_node_credit_score'
  const diffs: ModelNode[] = [
    // New node: Credit_Score input
    {
      id: idCreditScore,
      name: 'Credit_Score',
      typeRef: 'number',
      dependencies: [],
      content: { type: 'input', id: generateId('input'), defaultValue: '700' },
    },
    // Modified: replace Age_Check with Credit_Check
    // Arrow removed: Eligibility_Factors -> Age_Eligibility (red)
    // Arrow added: Eligibility_Factors -> Credit_Score (green)
    {
      ...eligibilityNode,
      content: {
        type: 'context',
        entries: [
          {
            id: '_ce_income_check',
            name: 'Income_Check',
            expression: { text: 'Income_Threshold', typeRef: 'boolean' },
          },
          {
            id: '_ce_credit_check',
            name: 'Credit_Check',
            expression: { text: 'Credit_Score > 650' },
          },
          {
            id: '_ce_return',
            name: '_return',
            expression: { text: 'Income_Check and Credit_Check' },
          },
        ],
      },
    },
    // Modified: also check Income_Threshold directly
    // Arrow added: Final_Recommendation -> Income_Threshold (green)
    {
      ...finalRecommendationNode,
      content: {
        type: 'context',
        entries: [
          {
            id: generateId('ce'),
            name: '_return',
            expression: {
              text: 'if Eligibility_Factors and Income_Threshold then "Approved" else "Denied"',
            },
          },
        ],
      },
    },
    // Deleted: Age_Eligibility no longer needed
    // Arrows to this node shown as red
    {
      ...ageEligibilityNode,
      deletedVersion: '2.0.0',
    },
    // Deleted: Applicant_Age no longer needed
    {
      ...applicantAgeNode,
      deletedVersion: '2.0.0',
    },
    // Deleted: Min_Age no longer needed
    {
      ...minAgeNode,
      deletedVersion: '2.0.0',
    },
    // Deleted: Max_Age no longer needed
    {
      ...maxAgeNode,
      deletedVersion: '2.0.0',
    },
  ]

  return { model, diffs }
}
