import type { Model } from '@/lib/model'
import type { RulesetSummary } from './rules-api'

export const MOCK_RULESETS: RulesetSummary[] = [
  { id: 'rac-eitc', name: 'Earned Income Tax Credit', format: 'rac' },
  {
    id: 'fg-standard-deduction',
    name: 'Standard Deduction',
    format: 'factGraph',
  },
]

const RAC_EITC_MODEL: Model = {
  id: 'rac-eitc',
  name: 'Earned Income Tax Credit',
  format: 'rac',
  nodes: {
    'rac-1': {
      id: 'rac-1',
      name: 'filing_status',
      dependencies: [],
      overridable: true,
      description: "The taxpayer's filing status for the tax year.",
      tags: ['input', 'taxpayer'],
      content: {
        format: 'rac',
        type: 'variable',
        role: 'input',
        path: '/taxpayer/filing_status',
        entity: 'taxpayer',
        label: 'Filing Status',
        source: 'IRC \u00a71(a)\u2013(e)',
      },
    },
    'rac-2': {
      id: 'rac-2',
      name: 'earned_income',
      dependencies: [],
      overridable: true,
      description:
        'Total earned income from wages, salaries, and self-employment.',
      tags: ['input', 'income'],
      content: {
        format: 'rac',
        type: 'variable',
        role: 'input',
        path: '/taxpayer/earned_income',
        entity: 'taxpayer',
        label: 'Earned Income',
        unit: 'USD',
        source: 'IRC \u00a732(c)(2)',
      },
    },
    'rac-3': {
      id: 'rac-3',
      name: 'qualifying_children',
      dependencies: [],
      overridable: true,
      description: 'Number of qualifying children for EITC purposes.',
      tags: ['input', 'dependents'],
      content: {
        format: 'rac',
        type: 'variable',
        role: 'input',
        path: '/taxpayer/qualifying_children_count',
        entity: 'taxpayer',
        label: 'Qualifying Children',
        default: '0',
        source: 'IRC \u00a732(c)(3)',
      },
    },
    'rac-4': {
      id: 'rac-4',
      name: 'agi',
      dependencies: ['rac-2'],
      overridable: true,
      description: 'Adjusted Gross Income.',
      tags: ['computed', 'income'],
      content: {
        format: 'rac',
        type: 'variable',
        role: 'computed',
        path: '/taxpayer/agi',
        entity: 'taxpayer',
        label: 'AGI',
        unit: 'USD',
        expression:
          'earned_income + investment_income + other_income - adjustments',
        source: 'IRC \u00a762',
      },
    },
    'rac-5': {
      id: 'rac-5',
      name: 'income_threshold',
      dependencies: ['rac-1', 'rac-3'],
      overridable: true,
      description:
        'Maximum income threshold based on filing status and number of children.',
      tags: ['threshold', 'eligibility'],
      content: {
        format: 'rac',
        type: 'variable',
        role: 'computed',
        path: '/eitc/income_threshold',
        label: 'Income Threshold',
        unit: 'USD',
        expression: 'lookup(filing_status, qualifying_children)',
        source: 'IRC \u00a732(b)',
        temporalValues: [
          {
            from: '2024-01-01',
            to: '2024-12-31',
            expression:
              'If qualifying_children = 0 then 18,591 else if qualifying_children = 1 then 46,560 else if qualifying_children = 2 then 52,918 else 56,838',
          },
          {
            from: '2025-01-01',
            expression:
              'If qualifying_children = 0 then 19,104 else if qualifying_children = 1 then 47,440 else if qualifying_children = 2 then 53,865 else 57,414',
          },
        ],
      },
    },
    'rac-6': {
      id: 'rac-6',
      name: 'eitc_eligible',
      dependencies: ['rac-4', 'rac-5', 'rac-1'],
      overridable: true,
      description: 'Whether the taxpayer is eligible for EITC.',
      tags: ['eligibility', 'output'],
      content: {
        format: 'rac',
        type: 'variable',
        role: 'computed',
        path: '/eitc/eligible',
        label: 'EITC Eligible',
        expression:
          'agi <= income_threshold AND filing_status != "married_filing_separately"',
        source: 'IRC \u00a732(a), (d)',
      },
    },
    'rac-7': {
      id: 'rac-7',
      name: 'credit_amount',
      dependencies: ['rac-6', 'rac-2', 'rac-3'],
      overridable: true,
      description: 'The calculated EITC credit amount.',
      tags: ['output', 'credit'],
      content: {
        format: 'rac',
        type: 'variable',
        role: 'computed',
        path: '/eitc/credit_amount',
        label: 'Credit Amount',
        unit: 'USD',
        expression:
          'If NOT eitc_eligible then 0 else credit_rate(qualifying_children) * min(earned_income, earned_income_amount(qualifying_children))',
        source: 'IRC \u00a732(a)(1)',
      },
    },
    'rac-8': {
      id: 'rac-8',
      name: 'taxpayer',
      dependencies: [],
      overridable: true,
      description: 'The taxpayer entity with basic demographic fields.',
      tags: ['entity'],
      content: {
        format: 'rac',
        type: 'entity',
        fields: [
          { name: 'first_name', dtype: 'str' },
          { name: 'last_name', dtype: 'str' },
          { name: 'date_of_birth', dtype: 'date' },
          { name: 'ssn', dtype: 'str' },
          { name: 'filing_status', dtype: 'str' },
        ],
        foreignKeys: [{ field: 'spouse', target: 'taxpayer' }],
      },
    },
  },
}

const FG_STANDARD_DEDUCTION_MODEL: Model = {
  id: 'fg-standard-deduction',
  name: 'Standard Deduction',
  format: 'factGraph',
  nodes: {
    'fg-1': {
      id: 'fg-1',
      name: 'filing_status',
      dependencies: [],
      overridable: true,
      description: 'Filing status selected by the taxpayer.',
      content: {
        format: 'factGraph',
        type: 'writable',
        role: 'input',
        path: '/filers/primary/filingStatus',
        typeName: 'Enum',
        enumOptionsPath: '/filingStatusOptions',
      },
    },
    'fg-2': {
      id: 'fg-2',
      name: 'is_blind',
      dependencies: [],
      overridable: true,
      description: 'Whether the primary filer is legally blind.',
      content: {
        format: 'factGraph',
        type: 'writable',
        role: 'input',
        path: '/filers/primary/isBlind',
        typeName: 'Boolean',
      },
    },
    'fg-3': {
      id: 'fg-3',
      name: 'date_of_birth',
      dependencies: [],
      overridable: true,
      description: 'Primary filer date of birth.',
      content: {
        format: 'factGraph',
        type: 'writable',
        role: 'input',
        path: '/filers/primary/dateOfBirth',
        typeName: 'Day',
        limits: [
          { type: 'Min', value: '1900-01-01' },
          { type: 'Max', value: '2024-12-31' },
        ],
      },
    },
    'fg-4': {
      id: 'fg-4',
      name: 'is_over_65',
      dependencies: ['fg-3'],
      overridable: true,
      description:
        'Whether the primary filer is 65 or older by end of tax year.',
      content: {
        format: 'factGraph',
        type: 'derived',
        role: 'computed',
        path: '/filers/primary/isOver65',
        logic: 'date_of_birth <= (tax_year_end - 65 years)',
      },
    },
    'fg-5': {
      id: 'fg-5',
      name: 'base_standard_deduction',
      dependencies: ['fg-1'],
      overridable: true,
      description: 'Base standard deduction amount before additional amounts.',
      content: {
        format: 'factGraph',
        type: 'derived',
        role: 'computed',
        path: '/deductions/standard/baseAmount',
        logic:
          'Match filing_status: Single \u2192 $14,600, MFJ \u2192 $29,200, MFS \u2192 $14,600, HoH \u2192 $21,900, QSS \u2192 $29,200',
      },
    },
    'fg-6': {
      id: 'fg-6',
      name: 'additional_deduction',
      dependencies: ['fg-1', 'fg-2', 'fg-4'],
      overridable: true,
      description: 'Additional standard deduction for age 65+ or blindness.',
      content: {
        format: 'factGraph',
        type: 'derived',
        role: 'computed',
        path: '/deductions/standard/additionalAmount',
        logic:
          'If Single or HoH: $1,950 per qualifying condition. If MFJ/MFS/QSS: $1,550 per qualifying condition. Conditions: is_over_65, is_blind.',
      },
    },
    'fg-7': {
      id: 'fg-7',
      name: 'total_standard_deduction',
      dependencies: ['fg-5', 'fg-6'],
      overridable: true,
      description: 'Total standard deduction (base + additional).',
      content: {
        format: 'factGraph',
        type: 'derived',
        role: 'computed',
        path: '/deductions/standard/totalAmount',
        logic: 'base_standard_deduction + additional_deduction',
      },
    },
  },
}

export const MOCK_MODELS: Record<string, Model> = {
  'rac-eitc': RAC_EITC_MODEL,
  'fg-standard-deduction': FG_STANDARD_DEDUCTION_MODEL,
}
