/**
 * Generate the static docs site for GitHub Pages.
 *
 * Inputs: the same Zod-driven OpenAPI document that the running API
 * serves at /v1/factgraph/openapi.yaml.
 * Outputs (into the directory passed as the first argument):
 *   - openapi.json  — machine-readable spec
 *   - openapi.yaml  — same spec, YAML
 *   - index.html    — Redoc renderer pointed at openapi.yaml (wrapped
 *                     with a small nav header linking to the explorer)
 *   - explore.html  — interactive target explorer; drives off the live
 *                     API (lifted from docs-site-templates/)
 *
 * Runs in CI via tsx (.github/workflows/docs.yml). Doesn't start the
 * server — just imports buildOpenApiDocument() and serializes the result.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import yaml from 'yaml'

import { buildOpenApiDocument } from '../packages/factgraph-api/src/openapi.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(process.argv[2] ?? 'build')
mkdirSync(outDir, { recursive: true })

const doc = buildOpenApiDocument()
writeFileSync(`${outDir}/openapi.json`, JSON.stringify(doc, null, 2))
writeFileSync(`${outDir}/openapi.yaml`, yaml.stringify(doc))

// Redoc is loaded from a CDN — no build step, no bundler. The spec
// loads via spec-url from the same directory, so the docs site is just
// a handful of files in a folder. A small nav strip above the Redoc
// viewport links across to the interactive target explorer.
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
      html, body { margin: 0; padding: 0; height: 100%; }
      .docs-nav {
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        padding: 0.6rem 1.25rem;
        background: #f3f4f6;
        border-bottom: 1px solid #e5e7eb;
        display: flex; gap: 1rem; align-items: center;
      }
      .docs-nav strong { color: #1f2937; }
      .docs-nav a { color: #2563eb; text-decoration: none; }
      .docs-nav a:hover { text-decoration: underline; }
      .docs-nav .spacer { flex: 1; }
      redoc { display: block; height: calc(100vh - 2.6rem); }
    </style>
  </head>
  <body>
    <nav class="docs-nav">
      <strong>Factgraph API</strong>
      <span>API spec</span>
      <span class="spacer"></span>
      <a href="./explore.html">Target explorer →</a>
    </nav>
    <redoc spec-url="./openapi.yaml"></redoc>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
  </body>
</html>
`
writeFileSync(`${outDir}/index.html`, html)

// Lift the explorer template into the build output. Sourced from
// scripts/docs-site-templates/explore.html so it can be edited as a
// real HTML file with syntax highlighting + diffable in PRs.
const explorerSrc = resolve(__dirname, 'docs-site-templates', 'explore.html')
writeFileSync(`${outDir}/explore.html`, readFileSync(explorerSrc, 'utf-8'))

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
