import { Router } from 'express'
import {
  getRuleset,
  getRawFacts,
  executeFactGraph,
} from 'rules-visualizer-factgraph-core'
import {
  readTests,
  writeTests,
  compareValues,
  type TestCase,
} from '../testStore.js'

const router = Router()

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
