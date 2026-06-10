/**
 * Drift guard: the committed OpenAPI snapshots must match what the generator
 * produces. If this fails, a schema or path changed without regenerating —
 * run: npm run gen:openapi --workspace=rules-visualizer-factgraph-api
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  renderOpenApiYaml,
  renderConsumerOpenApiYaml,
  renderV2OpenApiYaml,
} from '../scripts/generate-openapi.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const docs = path.resolve(__dirname, '..', 'docs')

test('committed openapi.yaml matches the generator output', () => {
  const committed = readFileSync(path.join(docs, 'openapi.yaml'), 'utf-8')
  assert.equal(
    committed,
    renderOpenApiYaml(),
    'docs/openapi.yaml is stale — run `npm run gen:openapi`'
  )
})

test('committed eligibility-adapter-openapi.yaml matches the generator output', () => {
  const committed = readFileSync(
    path.join(docs, 'eligibility-adapter-openapi.yaml'),
    'utf-8'
  )
  assert.equal(
    committed,
    renderConsumerOpenApiYaml(),
    'docs/eligibility-adapter-openapi.yaml is stale — run `npm run gen:openapi`'
  )
})

test('committed v2 proposal snapshot matches the generator output', () => {
  const committed = readFileSync(
    path.join(docs, 'eligibility-adapter-v2-proposal-openapi.yaml'),
    'utf-8'
  )
  assert.equal(
    committed,
    renderV2OpenApiYaml(),
    'docs/eligibility-adapter-v2-proposal-openapi.yaml is stale — run `npm run gen:openapi`'
  )
})
