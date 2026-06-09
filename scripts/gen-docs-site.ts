/**
 * Generate the static docs site for GitHub Pages.
 *
 * Renders TWO OpenAPI documents, the same ones the running API serves:
 *   - the consumer-facing Eligibility Adapter contract (the partner-facing
 *     page; /v1/eligibility/openapi.yaml) → index.html
 *   - the advanced Fact Graph query/discovery API (/v1/factgraph/openapi.yaml)
 *     → advanced.html
 *
 * Outputs (into the directory passed as the first argument):
 *   - eligibility-openapi.{json,yaml}, openapi.{json,yaml}
 *   - index.html       — Redoc over the eligibility contract (primary)
 *   - advanced.html    — Redoc over the advanced API
 *   - explore.html     — interactive target explorer (drives the live API)
 *
 * Runs in CI via tsx (.github/workflows/docs.yml). Doesn't start the server.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import yaml from 'yaml'

import { buildOpenApiDocument } from '../packages/factgraph-api/src/openapi.js'
import { buildConsumerOpenApiDocument } from '../packages/factgraph-api/src/consumer-openapi.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(process.argv[2] ?? 'build')
mkdirSync(outDir, { recursive: true })

const consumerDoc = buildConsumerOpenApiDocument()
const advancedDoc = buildOpenApiDocument()
writeFileSync(`${outDir}/eligibility-openapi.json`, JSON.stringify(consumerDoc, null, 2))
writeFileSync(`${outDir}/eligibility-openapi.yaml`, yaml.stringify(consumerDoc))
writeFileSync(`${outDir}/openapi.json`, JSON.stringify(advancedDoc, null, 2))
writeFileSync(`${outDir}/openapi.yaml`, yaml.stringify(advancedDoc))

// Redoc is loaded from a CDN — no build step. A small nav strip above the
// viewport links across the two contracts and the interactive explorer.
function redocPage(opts: {
  title: string
  here: 'consumer' | 'advanced'
  specUrl: string
  description: string
}): string {
  const tab = (href: string, label: string, active: boolean) =>
    active ? `<strong>${label}</strong>` : `<a href="${href}">${label}</a>`
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <title>${opts.title}</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${opts.description}" />
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
      ${tab('./index.html', 'Eligibility contract', opts.here === 'consumer')}
      ${tab('./advanced.html', 'Advanced API', opts.here === 'advanced')}
      <span class="spacer"></span>
      <a href="./explore.html">Target explorer →</a>
    </nav>
    <redoc spec-url="${opts.specUrl}"></redoc>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
  </body>
</html>
`
}

writeFileSync(
  `${outDir}/index.html`,
  redocPage({
    title: 'Eligibility Adapter API — docs',
    here: 'consumer',
    specUrl: './eligibility-openapi.yaml',
    description:
      'Consumer-facing eligibility determination contract — ORCA-shaped, no Fact Graph internals.',
  })
)
writeFileSync(
  `${outDir}/advanced.html`,
  redocPage({
    title: 'Factgraph API — advanced',
    here: 'advanced',
    specUrl: './openapi.yaml',
    description:
      'Advanced/tooling Fact Graph query + discovery API.',
  })
)

// Lift the explorer template into the build output. Sourced from
// scripts/docs-site-templates/explore.html so it can be edited as a
// real HTML file with syntax highlighting + diffable in PRs.
const explorerSrc = resolve(__dirname, 'docs-site-templates', 'explore.html')
writeFileSync(`${outDir}/explore.html`, readFileSync(explorerSrc, 'utf-8'))

// 404 page that points lost visitors at the index.
const notFound = `<!DOCTYPE html>
<html lang="en">
  <head>
    <title>Eligibility Adapter API — page not found</title>
    <meta charset="utf-8" />
    <style>
      body { font-family: Roboto, sans-serif; max-width: 36rem; margin: 4rem auto; padding: 0 1rem; }
      a { color: #2563eb; }
    </style>
  </head>
  <body>
    <h1>Page not found</h1>
    <p>This docs site renders the OpenAPI contracts for the Rules Engine API. Try the <a href="/">main page</a>.</p>
  </body>
</html>
`
writeFileSync(`${outDir}/404.html`, notFound)

console.log(`Wrote docs site to ${outDir}`)
