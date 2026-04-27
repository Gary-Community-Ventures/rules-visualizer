import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import crypto from 'node:crypto'
import { getRuleset, getRawFacts } from '../../store.js'
import { executeFactGraph } from '../../executor.js'
import {
  readTests,
  writeTests,
  compareValues,
  type TestCase,
} from '../../testStore.js'
import { resolvePathFromName } from './execution.js'
import type { Model } from '../../types.js'

function getModel(rulesetId: string): Model {
  const model = getRuleset(rulesetId)
  if (!model) throw new Error(`Ruleset "${rulesetId}" not found`)
  return model
}

/** Resolve all keys in a record from names to paths. */
function resolveKeys(
  model: Model,
  record: Record<string, unknown>
): { resolved: Record<string, unknown>; unresolved: string[] } {
  const resolved: Record<string, unknown> = {}
  const unresolved: string[] = []
  for (const [key, value] of Object.entries(record)) {
    const path = resolvePathFromName(model, key)
    if (path) {
      resolved[path] = value
    } else {
      unresolved.push(key)
    }
  }
  return { resolved, unresolved }
}

export const listTests = tool(
  (input: { rulesetId: string }) => {
    const tests = readTests(input.rulesetId)
    if (tests.length === 0) return 'No tests exist yet for this ruleset.'
    const lines = tests.map((t) => {
      const expectCount = Object.keys(t.expect).length
      const desc = t.description ? ` — ${t.description.slice(0, 60)}` : ''
      return `- ${t.name} (id: ${t.id}, ${expectCount} expectations)${desc}`
    })
    return `${tests.length} tests:\n${lines.join('\n')}`
  },
  {
    name: 'list_tests',
    description: 'List all test cases for a ruleset with their names and IDs.',
    schema: z.object({
      rulesetId: z.string().describe('The ruleset ID'),
    }),
  }
)

export const getTest = tool(
  (input: { rulesetId: string; testId: string }) => {
    const tests = readTests(input.rulesetId)
    const test = tests.find((t) => t.id === input.testId)
    if (!test) return `Test "${input.testId}" not found.`

    const model = getModel(input.rulesetId)
    const pathToName: Record<string, string> = {}
    for (const node of Object.values(model.nodes)) {
      if (node.content.type !== 'entity' && 'path' in node.content) {
        pathToName[node.content.path] = node.name
      }
    }

    const formatRecord = (rec: Record<string, unknown>) =>
      Object.entries(rec)
        .map(([k, v]) => `  ${pathToName[k] ?? k} = ${JSON.stringify(v)}`)
        .join('\n')

    const parts = [`Name: ${test.name}`]
    if (test.description) parts.push(`Description: ${test.description}`)
    if (test.inputs && Object.keys(test.inputs).length > 0) {
      parts.push(`Inputs:\n${formatRecord(test.inputs)}`)
    }
    if (test.overrides && Object.keys(test.overrides).length > 0) {
      parts.push(`Overrides:\n${formatRecord(test.overrides)}`)
    }
    if (test.entities) {
      for (const [coll, rows] of Object.entries(test.entities)) {
        parts.push(
          `Entity ${coll} (${rows.length} rows):\n${rows.map((r, i) => `  Row ${i + 1}: ${JSON.stringify(r)}`).join('\n')}`
        )
      }
    }
    parts.push(`Expectations:\n${formatRecord(test.expect)}`)

    return parts.join('\n')
  },
  {
    name: 'get_test',
    description: 'Get full details of a specific test case by ID.',
    schema: z.object({
      rulesetId: z.string().describe('The ruleset ID'),
      testId: z.string().describe('The test case ID'),
    }),
  }
)

export const runTests = tool(
  (input: { rulesetId: string; testIds?: string[] }) => {
    const model = getModel(input.rulesetId)
    const facts = getRawFacts(input.rulesetId)
    if (!facts) return 'No facts available for this ruleset.'

    const allTests = readTests(input.rulesetId)
    if (allTests.length === 0) return 'No tests exist yet for this ruleset.'

    const testsToRun = input.testIds
      ? allTests.filter((t) => input.testIds!.includes(t.id))
      : allTests

    if (testsToRun.length === 0) return 'No matching tests found.'

    let totalPassed = 0
    const summaries: string[] = []

    for (const test of testsToRun) {
      try {
        const allInputs = { ...(test.inputs ?? {}), ...(test.overrides ?? {}) }
        const pathResults = executeFactGraph(
          input.rulesetId,
          facts,
          allInputs,
          model.nodes as Record<string, { content: { dataType?: string } }>,
          test.entities as
            | Record<string, Record<string, unknown>[]>
            | undefined
        )

        let allPassed = true
        const failures: string[] = []

        for (const [path, expected] of Object.entries(test.expect)) {
          const actual = pathResults[path] ?? null
          if (!compareValues(expected, actual)) {
            allPassed = false
            failures.push(
              `  ${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
            )
          }
        }

        if (allPassed) {
          totalPassed++
          summaries.push(`✓ ${test.name}`)
        } else {
          summaries.push(`✗ ${test.name}\n${failures.join('\n')}`)
        }
      } catch (e) {
        summaries.push(`✗ ${test.name} — error: ${(e as Error).message}`)
      }
    }

    return `${totalPassed}/${testsToRun.length} tests passed\n\n${summaries.join('\n')}`
  },
  {
    name: 'run_tests',
    description:
      'Run all or specific test cases and return pass/fail results with details on failures.',
    schema: z.object({
      rulesetId: z.string().describe('The ruleset ID'),
      testIds: z
        .array(z.string())
        .optional()
        .describe('Specific test IDs to run. Omit to run all.'),
    }),
  }
)

export const createTest = tool(
  (input: {
    rulesetId: string
    name: string
    description?: string
    inputs?: Record<string, unknown>
    entities?: Record<string, Record<string, unknown>[]>
    overrides?: Record<string, unknown>
    expect: Record<string, unknown>
  }) => {
    const model = getModel(input.rulesetId)

    // Resolve names to paths in inputs
    const resolvedInputs = input.inputs
      ? resolveKeys(model, input.inputs)
      : { resolved: {}, unresolved: [] }

    const resolvedOverrides = input.overrides
      ? resolveKeys(model, input.overrides)
      : { resolved: {}, unresolved: [] }

    const resolvedExpect = resolveKeys(model, input.expect)

    const allUnresolved = [
      ...resolvedInputs.unresolved,
      ...resolvedOverrides.unresolved,
      ...resolvedExpect.unresolved,
    ]
    if (allUnresolved.length > 0) {
      return `Could not resolve these names to node paths: ${allUnresolved.join(', ')}. Use search_nodes to find the correct names.`
    }

    const newTest: TestCase = {
      id: crypto.randomUUID(),
      name: input.name,
      description: input.description,
      inputs:
        Object.keys(resolvedInputs.resolved).length > 0
          ? resolvedInputs.resolved
          : undefined,
      entities: input.entities,
      overrides:
        Object.keys(resolvedOverrides.resolved).length > 0
          ? resolvedOverrides.resolved
          : undefined,
      expect: resolvedExpect.resolved,
    }

    const tests = readTests(input.rulesetId)
    tests.push(newTest)
    const ok = writeTests(input.rulesetId, tests)
    if (!ok) return 'Failed to save test (no data directory configured).'

    return `Created test "${newTest.name}" (id: ${newTest.id}) with ${Object.keys(newTest.expect).length} expectations.`
  },
  {
    name: 'create_test',
    description:
      'Create a new test case with inputs and expected output values. Use node paths or names for keys.',
    schema: z.object({
      rulesetId: z.string().describe('The ruleset ID'),
      name: z.string().describe('Test case name'),
      description: z.string().optional().describe('Test description'),
      inputs: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Input values: node path/name → value'),
      entities: z
        .record(z.string(), z.array(z.record(z.string(), z.unknown())))
        .optional()
        .describe('Collection entity data'),
      overrides: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Override values for derived/constant nodes'),
      expect: z
        .record(z.string(), z.unknown())
        .describe('Expected output values: node path/name → expected value'),
    }),
  }
)

export const editTest = tool(
  (input: {
    rulesetId: string
    testId: string
    name?: string
    description?: string
    inputs?: Record<string, unknown>
    entities?: Record<string, Record<string, unknown>[]>
    overrides?: Record<string, unknown>
    expect?: Record<string, unknown>
  }) => {
    const tests = readTests(input.rulesetId)
    const idx = tests.findIndex((t) => t.id === input.testId)
    if (idx === -1) return `Test "${input.testId}" not found.`

    const model = getModel(input.rulesetId)

    // Resolve names to paths for any provided fields
    if (input.inputs) {
      const { resolved, unresolved } = resolveKeys(model, input.inputs)
      if (unresolved.length > 0) {
        return `Could not resolve: ${unresolved.join(', ')}`
      }
      tests[idx].inputs = resolved
    }
    if (input.overrides) {
      const { resolved, unresolved } = resolveKeys(model, input.overrides)
      if (unresolved.length > 0) {
        return `Could not resolve: ${unresolved.join(', ')}`
      }
      tests[idx].overrides = resolved
    }
    if (input.expect) {
      const { resolved, unresolved } = resolveKeys(model, input.expect)
      if (unresolved.length > 0) {
        return `Could not resolve: ${unresolved.join(', ')}`
      }
      tests[idx].expect = resolved
    }
    if (input.name !== undefined) tests[idx].name = input.name
    if (input.description !== undefined)
      tests[idx].description = input.description
    if (input.entities !== undefined) tests[idx].entities = input.entities

    const ok = writeTests(input.rulesetId, tests)
    if (!ok) return 'Failed to save test.'

    return `Updated test "${tests[idx].name}" (id: ${tests[idx].id}).`
  },
  {
    name: 'edit_test',
    description:
      'Edit an existing test case. Only the provided fields are updated; others are left unchanged.',
    schema: z.object({
      rulesetId: z.string().describe('The ruleset ID'),
      testId: z.string().describe('The test case ID to edit'),
      name: z.string().optional().describe('New test name'),
      description: z.string().optional().describe('New description'),
      inputs: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Replace input values'),
      entities: z
        .record(z.string(), z.array(z.record(z.string(), z.unknown())))
        .optional()
        .describe('Replace entity data'),
      overrides: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Replace override values'),
      expect: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Replace expected values'),
    }),
  }
)

export const deleteTest = tool(
  (input: { rulesetId: string; testId: string }) => {
    const tests = readTests(input.rulesetId)
    const before = tests.length
    const remaining = tests.filter((t) => t.id !== input.testId)
    if (remaining.length === before) return `Test "${input.testId}" not found.`

    const deleted = tests.find((t) => t.id === input.testId)!
    writeTests(input.rulesetId, remaining)
    return `Deleted test "${deleted.name}" (id: ${input.testId}).`
  },
  {
    name: 'delete_test',
    description: 'Delete a test case by ID.',
    schema: z.object({
      rulesetId: z.string().describe('The ruleset ID'),
      testId: z.string().describe('The test case ID to delete'),
    }),
  }
)

export const TEST_TOOLS = [
  listTests,
  getTest,
  runTests,
  createTest,
  editTest,
  deleteTest,
]
