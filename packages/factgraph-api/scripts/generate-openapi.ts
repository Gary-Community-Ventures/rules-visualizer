/**
 * Generate the checked-in OpenAPI snapshot (docs/openapi.yaml) from the
 * single source of truth — buildOpenApiDocument() in src/openapi.ts.
 *
 * The snapshot exists so integration partners can review and comment on
 * the contract as a plain YAML file (the same artifact shape their own
 * contracts use) without reading TypeScript. It is also served live at
 * GET /v1/factgraph/openapi.yaml; this file is just a committed copy.
 *
 * Run `npm run gen:openapi` after changing any request/response schema or
 * path. The `openapi-snapshot.test.ts` test fails if the committed file
 * drifts from what this generator would produce.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import yaml from 'yaml'

import { buildOpenApiDocument } from '../src/openapi.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(__dirname, '..', 'docs', 'openapi.yaml')

export function renderOpenApiYaml(): string {
  const banner =
    '# GENERATED FILE — do not edit by hand.\n' +
    '# Source: packages/factgraph-api/src/openapi.ts (buildOpenApiDocument).\n' +
    '# Regenerate: npm run gen:openapi --workspace=rules-visualizer-factgraph-api\n'
  return banner + yaml.stringify(buildOpenApiDocument())
}

// Only write when run as a script (not when imported by the drift test).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  writeFileSync(OUT, renderOpenApiYaml())
  console.log(`Wrote ${OUT}`)
}
