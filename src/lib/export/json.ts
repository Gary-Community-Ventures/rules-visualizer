import { z } from 'zod'
import type { Model } from '@/lib/model'

// ─── Zod Schema ──────────────────────────────────────────────────

const feelDataTypeSchema = z.enum([
  'number',
  'string',
  'boolean',
  'date',
  'time',
  'dateTime',
  'dayTimeDuration',
  'yearMonthDuration',
])

const contextEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  expression: z.object({
    text: z.string(),
    typeRef: feelDataTypeSchema.optional(),
  }),
})

const inputClauseSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  inputExpression: z.string(),
  inputExpressionTypeRef: feelDataTypeSchema.optional(),
})

const outputClauseSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  name: z.string().min(1),
  typeRef: feelDataTypeSchema.optional(),
})

const decisionTableRuleSchema = z.object({
  id: z.string().min(1),
  inputEntries: z.array(z.string()),
  outputEntries: z.array(z.string()),
  annotationEntries: z.array(z.string()),
})

const inputSchema = z.object({
  type: z.literal('input'),
  id: z.string().min(1),
})

const constantSchema = z.object({
  type: z.literal('constant'),
  text: z.string(),
  typeRef: feelDataTypeSchema.optional(),
})

const contextSchema = z.object({
  type: z.literal('context'),
  entries: z.array(contextEntrySchema),
})

const decisionTableSchema = z.object({
  type: z.literal('decisionTable'),
  hitPolicy: z.enum([
    'UNIQUE',
    'ANY',
    'PRIORITY',
    'FIRST',
    'OUTPUT ORDER',
    'RULE ORDER',
    'COLLECT',
  ]),
  aggregation: z.enum(['SUM', 'COUNT', 'MIN', 'MAX']).optional(),
  inputClauses: z.array(inputClauseSchema),
  outputClauses: z.array(outputClauseSchema),
  rules: z.array(decisionTableRuleSchema),
})

const nodeContentSchema = z.discriminatedUnion('type', [
  inputSchema,
  constantSchema,
  contextSchema,
  decisionTableSchema,
])

const nodeTestCaseSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  inputs: z.record(z.string(), z.unknown()),
  expected: z.string(),
})

const modelNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  typeRef: feelDataTypeSchema.optional(),
  dependencies: z.array(z.string()),
  content: nodeContentSchema,
  tests: z.array(nodeTestCaseSchema).optional(),
})

const modelSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    namespace: z.string().min(1),
    nodes: z.record(z.string(), modelNodeSchema),
  })
  .refine(
    (model) =>
      Object.entries(model.nodes).every(([key, node]) => key === node.id),
    { message: 'Node record keys must match their id fields' }
  )

// ─── Public API ──────────────────────────────────────────────────

export function exportModelToJson(model: Model): string {
  return JSON.stringify(model, null, 2)
}

export function importModelFromJson(jsonString: string): Model {
  const parsed = JSON.parse(jsonString)
  return modelSchema.parse(parsed)
}
