/**
 * Drift guard: the committed docs/openapi.yaml must match what the
 * generator produces from src/openapi.ts. If this fails, a schema or path
 * changed without regenerating the snapshot — run:
 *   npm run gen:openapi --workspace=rules-visualizer-factgraph-api
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderOpenApiYaml } from '../scripts/generate-openapi.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SNAPSHOT = path.resolve(__dirname, '..', 'docs', 'openapi.yaml')

test('committed openapi.yaml matches the generator output', () => {
  const committed = readFileSync(SNAPSHOT, 'utf-8')
  assert.equal(
    committed,
    renderOpenApiYaml(),
    'docs/openapi.yaml is stale — run `npm run gen:openapi`'
  )
})
