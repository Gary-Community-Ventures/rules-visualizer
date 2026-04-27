import fs from 'node:fs'
import path from 'node:path'
import { getDataDir } from './store.js'

export type TestCase = {
  id: string
  name: string
  description?: string
  inputs?: Record<string, unknown>
  entities?: Record<string, Record<string, unknown>[]>
  overrides?: Record<string, unknown>
  expect: Record<string, unknown>
}

export function getTestsPath(rulesetId: string): string | null {
  const dataDir = getDataDir()
  if (!dataDir) return null
  return path.join(dataDir, rulesetId, 'tests.json')
}

export function readTests(rulesetId: string): TestCase[] {
  const testsPath = getTestsPath(rulesetId)
  if (!testsPath || !fs.existsSync(testsPath)) return []
  try {
    return JSON.parse(fs.readFileSync(testsPath, 'utf-8'))
  } catch {
    return []
  }
}

export function writeTests(rulesetId: string, tests: TestCase[]): boolean {
  const testsPath = getTestsPath(rulesetId)
  if (!testsPath) return false
  fs.writeFileSync(testsPath, JSON.stringify(tests, null, 2))
  return true
}

export function compareValues(
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
