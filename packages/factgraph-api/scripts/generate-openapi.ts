/**
 * Generate the checked-in OpenAPI snapshots from the single sources of truth:
 *   - docs/openapi.yaml                  ← buildOpenApiDocument() (advanced API)
 *   - docs/eligibility-adapter-openapi.yaml ← buildConsumerOpenApiDocument()
 *
 * The snapshots exist so integration partners can review and comment on the
 * contracts as plain YAML files (the same artifact shape their own contracts
 * use) without reading TypeScript. They're also served live at
 * GET /v1/factgraph/openapi.yaml and GET /v1/eligibility/openapi.yaml.
 *
 * Run `npm run gen:openapi` after changing any schema or path. The
 * `openapi-snapshot.test.ts` test fails if either committed file drifts.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import yaml from 'yaml'

import { buildOpenApiDocument } from '../src/openapi.js'
import { buildConsumerOpenApiDocument } from '../src/consumer-openapi.js'
import { buildV2OpenApiDocument } from '../src/v2-openapi.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ADVANCED_OUT = path.resolve(__dirname, '..', 'docs', 'openapi.yaml')
const CONSUMER_OUT = path.resolve(
  __dirname,
  '..',
  'docs',
  'eligibility-adapter-openapi.yaml'
)
const V2_OUT = path.resolve(
  __dirname,
  '..',
  'docs',
  'eligibility-adapter-v2-proposal-openapi.yaml'
)

function banner(source: string): string {
  return (
    '# GENERATED FILE — do not edit by hand.\n' +
    `# Source: packages/factgraph-api/src/${source}\n` +
    '# Regenerate: npm run gen:openapi --workspace=rules-visualizer-factgraph-api\n'
  )
}

export function renderOpenApiYaml(): string {
  return banner('openapi.ts (buildOpenApiDocument)') + yaml.stringify(buildOpenApiDocument())
}

export function renderConsumerOpenApiYaml(): string {
  return (
    banner('consumer-openapi.ts (buildConsumerOpenApiDocument)') +
    yaml.stringify(buildConsumerOpenApiDocument())
  )
}

export function renderV2OpenApiYaml(): string {
  return (
    banner('v2-openapi.ts (buildV2OpenApiDocument) — DRAFT PROPOSAL') +
    yaml.stringify(buildV2OpenApiDocument())
  )
}

// Only write when run as a script (not when imported by the drift test).
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  writeFileSync(ADVANCED_OUT, renderOpenApiYaml())
  writeFileSync(CONSUMER_OUT, renderConsumerOpenApiYaml())
  writeFileSync(V2_OUT, renderV2OpenApiYaml())
  console.log(`Wrote ${ADVANCED_OUT}`)
  console.log(`Wrote ${CONSUMER_OUT}`)
  console.log(`Wrote ${V2_OUT}`)
}
