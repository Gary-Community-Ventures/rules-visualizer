/**
 * Generate the static docs site for GitHub Pages.
 *
 * Inputs: the same Zod-driven OpenAPI document that the running API
 * serves at /v1/factgraph/openapi.yaml.
 * Outputs (into the directory passed as the first argument):
 *   - openapi.json  — machine-readable spec
 *   - openapi.yaml  — same spec, YAML
 *   - index.html    — Redoc renderer pointed at openapi.yaml
 *
 * Runs in CI via tsx (.github/workflows/docs.yml). Doesn't start the
 * server — just imports buildOpenApiDocument() and serializes the result.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import yaml from 'yaml'

import { buildOpenApiDocument } from '../packages/factgraph-api/src/openapi.js'

const outDir = resolve(process.argv[2] ?? 'build')
mkdirSync(outDir, { recursive: true })

const doc = buildOpenApiDocument()
writeFileSync(`${outDir}/openapi.json`, JSON.stringify(doc, null, 2))
writeFileSync(`${outDir}/openapi.yaml`, yaml.stringify(doc))

// Redoc is loaded from a CDN — no build step, no bundler. The spec
// loads via spec-url from the same directory, so the docs site is just
// three files in a folder.
const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <title>Factgraph API — docs</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="HTTP adapter API for Fact Graph rulesets — read the contract, browse endpoints, copy example payloads." />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet" />
    <style>
      body { margin: 0; padding: 0; }
    </style>
  </head>
  <body>
    <redoc spec-url="./openapi.yaml"></redoc>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
  </body>
</html>
`
writeFileSync(`${outDir}/index.html`, html)

// Also write a 404 page that points lost visitors at the index. Pages
// returns this for any path that doesn't resolve.
const notFound = `<!DOCTYPE html>
<html lang="en">
  <head>
    <title>Factgraph API — page not found</title>
    <meta charset="utf-8" />
    <style>
      body { font-family: Roboto, sans-serif; max-width: 36rem; margin: 4rem auto; padding: 0 1rem; }
      a { color: #2563eb; }
    </style>
  </head>
  <body>
    <h1>Page not found</h1>
    <p>This docs site renders the OpenAPI spec for the Factgraph API. Try the <a href="/">main page</a>.</p>
  </body>
</html>
`
writeFileSync(`${outDir}/404.html`, notFound)

console.log(`Wrote docs site to ${outDir}`)
