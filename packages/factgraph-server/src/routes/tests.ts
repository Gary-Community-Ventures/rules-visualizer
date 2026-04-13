import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { getRuleset, getRawFacts, getDataDir } from '../store.js'
import { executeFactGraph } from '../executor.js'

const router = Router()

type TestCase = {
  id: string
  name: string
  description?: string
  inputs?: Record<string, unknown>
  entities?: Record<string, Record<string, unknown>[]>
  overrides?: Record<string, unknown>
  expect: Record<string, unknown>
}

function getTestsPath(rulesetId: string): string | null {
  const dataDir = getDataDir()
  if (!dataDir) return null
  return path.join(dataDir, rulesetId, 'tests.json')
}

function readTests(rulesetId: string): TestCase[] {
  const testsPath = getTestsPath(rulesetId)
  if (!testsPath || !fs.existsSync(testsPath)) return []
  try {
    return JSON.parse(fs.readFileSync(testsPath, 'utf-8'))
  } catch {
    return []
  }
}

function writeTests(rulesetId: string, tests: TestCase[]): boolean {
  const testsPath = getTestsPath(rulesetId)
  if (!testsPath) return false
  fs.writeFileSync(testsPath, JSON.stringify(tests, null, 2))
  return true
}

function compareValues(
  expected: unknown,
  actual: unknown,
  tolerance = 0.01
): boolean {
  if (expected === actual) return true
  if (expected === null || actual === null) return false
  if (typeof expected === 'boolean' || typeof actual === 'boolean') {
    return expected === actual
  }
  if (typeof expected === 'number' && typeof actual === 'number') {
    return Math.abs(expected - actual) <= tolerance
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) return false
    return expected.every((e, i) => compareValues(e, actual[i], tolerance))
  }
  return String(expected) === String(actual)
}

// GET /api/rulesets/:id/tests
router.get('/rulesets/:id/tests', (req, res) => {
  const model = getRuleset(req.params.id)
  if (!model) {
    res.status(404).json({ error: 'Ruleset not found' })
    return
  }
  res.json({ tests: readTests(req.params.id) })
})

// POST /api/rulesets/:id/tests
router.post('/rulesets/:id/tests', (req, res) => {
  const model = getRuleset(req.params.id)
  if (!model) {
    res.status(404).json({ error: 'Ruleset not found' })
    return
  }
  const tests = readTests(req.params.id)
  const newTest: TestCase = {
    id: crypto.randomUUID(),
    name: req.body.name ?? 'Untitled test',
    description: req.body.description,
    inputs: req.body.inputs ?? {},
    entities: req.body.entities,
    overrides: req.body.overrides,
    expect: req.body.expect ?? {},
  }
  tests.push(newTest)
  writeTests(req.params.id, tests)
  res.json(newTest)
})

// PUT /api/rulesets/:id/tests/:testId
router.put('/rulesets/:id/tests/:testId', (req, res) => {
  const tests = readTests(req.params.id)
  const idx = tests.findIndex((t) => t.id === req.params.testId)
  if (idx === -1) {
    res.status(404).json({ error: 'Test not found' })
    return
  }
  tests[idx] = { ...tests[idx], ...req.body, id: req.params.testId }
  writeTests(req.params.id, tests)
  res.json(tests[idx])
})

// DELETE /api/rulesets/:id/tests/:testId
router.delete('/rulesets/:id/tests/:testId', (req, res) => {
  let tests = readTests(req.params.id)
  const before = tests.length
  tests = tests.filter((t) => t.id !== req.params.testId)
  if (tests.length === before) {
    res.status(404).json({ error: 'Test not found' })
    return
  }
  writeTests(req.params.id, tests)
  res.json({ success: true })
})

// POST /api/rulesets/:id/tests/run
router.post('/rulesets/:id/tests/run', (req, res) => {
  const rulesetId = req.params.id
  const model = getRuleset(rulesetId)
  if (!model) {
    res.status(404).json({ error: 'Ruleset not found' })
    return
  }
  const facts = getRawFacts(rulesetId)
  if (!facts) {
    res.status(400).json({ error: 'No raw facts available' })
    return
  }

  const tests = readTests(rulesetId)
  const testIds: string[] | undefined = req.body?.testIds

  const testsToRun = testIds
    ? tests.filter((t) => testIds.includes(t.id))
    : tests

  const results = testsToRun.map((test) => {
    try {
      // Merge inputs + overrides
      const allInputs = { ...(test.inputs ?? {}), ...(test.overrides ?? {}) }

      const pathResults = executeFactGraph(
        rulesetId,
        facts,
        allInputs,
        model.nodes as Record<string, { content: { dataType?: string } }>,
        test.entities as Record<string, Record<string, unknown>[]> | undefined
      )

      // Build path→nodeId map
      const pathToNodeId: Record<string, string> = {}
      for (const [nodeId, node] of Object.entries(model.nodes)) {
        const p = node.content.type === 'entity' ? undefined : node.content.path
        if (p) pathToNodeId[p] = nodeId
      }

      // Compare expectations
      const expectations: Record<
        string,
        { expected: unknown; actual: unknown; passed: boolean }
      > = {}
      let allPassed = true

      for (const [expectPath, expectedValue] of Object.entries(test.expect)) {
        const actual = pathResults[expectPath] ?? null
        const passed = compareValues(expectedValue, actual)
        expectations[expectPath] = {
          expected: expectedValue,
          actual,
          passed,
        }
        if (!passed) allPassed = false
      }

      return {
        testId: test.id,
        name: test.name,
        passed: allPassed,
        expectations,
        computedValues: pathResults,
      }
    } catch (e) {
      return {
        testId: test.id,
        name: test.name,
        passed: false,
        error: (e as Error).message,
        expectations: {},
      }
    }
  })

  res.json({ results })
})

export default router
