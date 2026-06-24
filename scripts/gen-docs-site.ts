/**
 * Generate the static docs site for GitHub Pages.
 *
 * Renders THREE OpenAPI documents, the same ones the running API serves:
 *   - the v2 engine-shaped eligibility API (/v2/eligibility/openapi.yaml) → eligibility-v2.html
 *   - the v1 frozen eligibility adapter (/v1/eligibility/openapi.yaml) → index.html
 *   - the advanced Fact Graph query/discovery API (/v1/factgraph/openapi.yaml) → advanced.html
 *
 * Outputs (into the directory passed as the first argument):
 *   - eligibility-v2-openapi.{json,yaml}
 *   - eligibility-openapi.{json,yaml}, openapi.{json,yaml}
 *   - eligibility-v2.html — Redoc over the v2 engine-shaped contract (primary)
 *   - index.html          — Redoc over the v1 frozen contract
 *   - advanced.html       — Redoc over the advanced API
 *   - explore.html        — interactive target explorer (drives the live API)
 *
 * Runs in CI via tsx (.github/workflows/docs.yml). Doesn't start the server.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import yaml from 'yaml'

import { buildOpenApiDocument } from '../packages/factgraph-api/src/openapi.js'
import { buildConsumerOpenApiDocument } from '../packages/factgraph-api/src/consumer-openapi.js'
import { buildV2OpenApiDocument } from '../packages/factgraph-api/src/v2-openapi.js'
import { buildDictionaryData } from '../packages/factgraph-api/scripts/generate-input-dictionary.js'
import { buildEngineInputs, DICTIONARY_SCHEMA_VERSION } from '../packages/factgraph-api/scripts/generate-engine-inputs.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(process.argv[2] ?? 'build')
mkdirSync(outDir, { recursive: true })

const consumerDoc = buildConsumerOpenApiDocument()
const advancedDoc = buildOpenApiDocument()
const v2Doc = buildV2OpenApiDocument()
writeFileSync(`${outDir}/eligibility-openapi.json`, JSON.stringify(consumerDoc, null, 2))
writeFileSync(`${outDir}/eligibility-openapi.yaml`, yaml.stringify(consumerDoc))
writeFileSync(`${outDir}/eligibility-v2-openapi.json`, JSON.stringify(v2Doc, null, 2))
writeFileSync(`${outDir}/eligibility-v2-openapi.yaml`, yaml.stringify(v2Doc))
writeFileSync(`${outDir}/openapi.json`, JSON.stringify(advancedDoc, null, 2))
writeFileSync(`${outDir}/openapi.yaml`, yaml.stringify(advancedDoc))

// Redoc is loaded from a CDN — no build step. A small nav strip above the
// viewport links across the contracts and the interactive explorer.
function redocPage(opts: {
  title: string
  here: 'v2' | 'v1' | 'advanced'
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
      ${tab('./eligibility-v2.html', 'v2 API', opts.here === 'v2')}
      <a href="./engine-inputs.html">Engine inputs</a>
      ${tab('./index.html', 'v1 API (frozen)', opts.here === 'v1')}
      <a href="./dictionary.html">Legacy inputs</a>
      <span class="spacer"></span>
      ${tab('./advanced.html', 'Advanced API', opts.here === 'advanced')}
      <a href="./explore.html">Target explorer →</a>
    </nav>
    <redoc spec-url="${opts.specUrl}"></redoc>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
  </body>
</html>
`
}

writeFileSync(
  `${outDir}/eligibility-v2.html`,
  redocPage({
    title: 'Eligibility API v2 (engine-shaped) — docs',
    here: 'v2',
    specUrl: './eligibility-v2-openapi.yaml',
    description:
      'Engine-shaped eligibility determination API — per-program endpoints, no-guess, friendly fields.',
  })
)
writeFileSync(
  `${outDir}/index.html`,
  redocPage({
    title: 'Eligibility Adapter API v1 (frozen) — docs',
    here: 'v1',
    specUrl: './eligibility-openapi.yaml',
    description:
      'Consumer-facing eligibility determination contract v1 — ORCA-shaped, frozen.',
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

// Legacy inputs — filterable HTML rendering of the same data that
// generates docs/input-dictionary.md. Cards (not a wide table) so the
// rule-author definitions wrap; client-side text search + program/source
// filters, no build step. Data is also emitted as dictionary.json for
// tooling.
const dict = buildDictionaryData()
writeFileSync(`${outDir}/dictionary.json`, JSON.stringify(dict, null, 2))

const dictionaryHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <title>Legacy inputs — Eligibility Adapter API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Every eligibility request field with its regulatory definition, enum vocabulary, policy citations, and realistic source." />
    <style>
      :root { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
      body { margin: 0; color: #1f2937; }
      .docs-nav {
        font-size: 14px; padding: 0.6rem 1.25rem; background: #f3f4f6;
        border-bottom: 1px solid #e5e7eb; display: flex; gap: 1rem; align-items: center;
      }
      .docs-nav strong { color: #1f2937; }
      .docs-nav a { color: #2563eb; text-decoration: none; }
      .docs-nav .spacer { flex: 1; }
      main { max-width: 56rem; margin: 0 auto; padding: 1rem 1.25rem 4rem; }
      .controls { display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: center;
        position: sticky; top: 0; background: #fff; padding: 0.75rem 0; border-bottom: 1px solid #e5e7eb; z-index: 2; }
      .controls input, .controls select { padding: 0.45rem 0.6rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; }
      .controls input { flex: 1; min-width: 14rem; }
      .count { color: #6b7280; font-size: 13px; }
      h2.group { font-size: 1.05rem; margin: 1.8rem 0 0.4rem; color: #374151; }
      .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 0.8rem 1rem; margin: 0.6rem 0; }
      .card code.field { font-weight: 600; font-size: 0.95rem; }
      .badges { margin: 0.35rem 0 0.5rem; display: flex; gap: 0.35rem; flex-wrap: wrap; }
      .badge { font-size: 11.5px; padding: 0.1rem 0.5rem; border-radius: 999px; background: #f3f4f6; color: #374151; }
      .badge.src-applicant { background: #dcfce7; color: #166534; }
      .badge.src-state { background: #dbeafe; color: #1e40af; }
      .badge.src-either { background: #fef9c3; color: #854d0e; }
      .badge.published { background: #ede9fe; color: #5b21b6; }
      .badge.superseded { background: #ffedd5; color: #9a3412; }
      .def { font-size: 14px; line-height: 1.5; }
      .note { font-size: 13px; color: #6b7280; font-style: italic; margin-top: 0.35rem; }
      .cite { font-size: 12.5px; color: #6b7280; margin-top: 0.4rem; }
      details.values { margin-top: 0.4rem; font-size: 13px; }
      details.values code { background: #f3f4f6; padding: 0 0.3rem; border-radius: 4px; }
      .hidden { display: none; }
    </style>
  </head>
  <body>
    <nav class="docs-nav">
      <a href="./eligibility-v2.html">v2 API</a>
      <a href="./engine-inputs.html">Engine inputs</a>
      <a href="./index.html">v1 API (frozen)</a>
      <strong>Legacy inputs</strong>
      <span class="spacer"></span>
      <a href="./advanced.html">Advanced API</a>
      <a href="./explore.html">Target explorer →</a>
    </nav>
    <main>
      <h1>Legacy inputs</h1>
      <p style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:0.6rem 0.9rem;color:#92400e;">
      <strong>Superseded.</strong> This documents the earlier ORCA-shaped v1 mapping
      (a union of the partner's published contract and our engine inputs, with
      best-guess source classifications). The current source of truth is
      <a href="./engine-inputs.html">Engine inputs</a> — every input the engine
      actually accepts, keyed as you send it. Kept here for reference only.</p>
      <p>Every request field in the <a href="./index.html">v1 API contract</a>,
      with the rule authors' own definitions, enum vocabularies,
      and policy citations — generated from the rulesets.
      <strong>Source</strong> is our best guess at where each value realistically
      originates, offered for the partner teams to correct. The purple
      <em>in worker-portal contract</em> badge marks fields that already exist in the
      partner's published eligibility-adapter contract — candidate additions are
      the applicant-sourced fields without it.
      Also available as <a href="./dictionary.json">JSON</a> or
      <a href="https://github.com/Gary-Community-Ventures/rules-visualizer/blob/main/packages/factgraph-api/docs/input-dictionary.md">markdown</a>.</p>
      <div class="controls">
        <input id="q" type="search" placeholder="Search fields and definitions…" />
        <select id="program">
          <option value="">All programs</option>
          <option>SNAP</option>
          <option>Medicaid</option>
        </select>
        <select id="source">
          <option value="">All sources</option>
          <option value="applicant">applicant</option>
          <option value="state">state</option>
          <option value="either">either</option>
        </select>
        <span class="count" id="count"></span>
      </div>
      <div id="list"></div>
    </main>
    <script id="data" type="application/json">__DATA__</script>
    <script>
      const data = JSON.parse(document.getElementById('data').textContent)
      const list = document.getElementById('list')
      const esc = (s) => s.replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))
      function citeText(cs) {
        return cs.map((c) => c.pages.length ? c.title + ' — ' + (c.pages.length > 1 ? 'pp. ' : 'p. ') + c.pages.join(', ') : c.title).join('; ')
      }
      for (const group of data.groups) {
        const h = document.createElement('h2')
        h.className = 'group'; h.textContent = group.title
        list.appendChild(h)
        for (const e of group.entries) {
          const card = document.createElement('div')
          card.className = 'card'
          card.dataset.text = (e.field + ' ' + (e.definition || '') + ' ' + (e.note || '')).toLowerCase()
          card.dataset.programs = e.programs.join(',')
          card.dataset.source = e.source || ''
          const badges = [
            '<span class="badge">' + esc(e.type) + '</span>',
            ...e.programs.map((p) => '<span class="badge">' + p + '</span>'),
            '<span class="badge">' + e.kind + '</span>',
            e.source ? '<span class="badge src-' + e.source + '">' + e.source + '</span>' : '',
            e.inPublishedContract ? '<span class="badge published">in worker-portal contract</span>' : '',
            e.supersededBy ? '<span class="badge superseded">→ prefer ' + esc(e.supersededBy) + '</span>' : '',
          ].filter(Boolean).join('')
          let values = ''
          if (e.values) {
            values = '<details class="values"><summary>' + e.values.length + ' allowed values</summary><p>' +
              e.values.map((v) => '<code>' + esc(v) + '</code>').join(' ') + '</p></details>'
          }
          card.innerHTML =
            '<code class="field">' + esc(e.field) + '</code>' +
            '<div class="badges">' + badges + '</div>' +
            (e.definition ? '<div class="def">' + esc(e.definition) + '</div>' : '') +
            (e.note ? '<div class="note">Adapter mapping: ' + esc(e.note) + '</div>' : '') +
            values +
            (e.citations.length ? '<div class="cite">' + esc(citeText(e.citations)) + '</div>' : '')
          list.appendChild(card)
        }
      }
      const q = document.getElementById('q')
      const program = document.getElementById('program')
      const source = document.getElementById('source')
      const count = document.getElementById('count')
      function apply() {
        const term = q.value.toLowerCase().trim()
        let shown = 0
        const cards = list.querySelectorAll('.card')
        for (const card of cards) {
          const ok =
            (!term || card.dataset.text.includes(term)) &&
            (!program.value || card.dataset.programs.includes(program.value)) &&
            (!source.value || card.dataset.source === source.value)
          card.classList.toggle('hidden', !ok)
          if (ok) shown++
        }
        for (const h of list.querySelectorAll('h2.group')) {
          let el = h.nextElementSibling, any = false
          while (el && el.tagName !== 'H2') {
            if (!el.classList.contains('hidden')) { any = true; break }
            el = el.nextElementSibling
          }
          h.classList.toggle('hidden', !any)
        }
        count.textContent = shown + ' fields'
      }
      q.addEventListener('input', apply)
      program.addEventListener('change', apply)
      source.addEventListener('change', apply)
      apply()
    </script>
  </body>
</html>
`
writeFileSync(
  `${outDir}/dictionary.html`,
  dictionaryHtml.replace('__DATA__', JSON.stringify(dict).replace(/</g, '\\u003c'))
)

// Engine inputs — the canonical catalog of every input the engine accepts
// (the source of truth a consumer builds their data model against). Same data
// as docs/engine-inputs.json; rendered as filterable cards. No "source"
// guesswork here — every field is tagged applicant / derived / reference.
const engine = buildEngineInputs()
writeFileSync(`${outDir}/engine-inputs.json`, JSON.stringify(engine, null, 2))

// Historical versioned snapshots — committed alongside each version bump by
// the generate-engine-inputs script. Discovered at build time so the docs
// site grows automatically when a new snapshot is committed.
const apiDocsDir = resolve(__dirname, '../packages/factgraph-api/docs')
type EngineSnapshot = { version: string; data: typeof engine }
const versionedSnapshots: EngineSnapshot[] = readdirSync(apiDocsDir)
  .filter((f) => /^engine-inputs-v\d+\.\d+\.\d+\.json$/.test(f))
  .map((f) => ({
    version: f.match(/v(\d+\.\d+\.\d+)/)![1],
    data: JSON.parse(readFileSync(resolve(apiDocsDir, f), 'utf-8')) as typeof engine,
  }))
  .sort((a, b) => {
    const [am, an, ap] = a.version.split('.').map(Number)
    const [bm, bn, bp] = b.version.split('.').map(Number)
    return bm - am || bn - an || bp - ap
  })

const allSnapshotVersions = versionedSnapshots.map((s) => s.version)

const CHANGELOG_URL =
  'https://github.com/Gary-Community-Ventures/rules-visualizer/blob/main/packages/factgraph-api/docs/engine-inputs-changelog.md'

function buildVersionNav(activeKey: 'latest' | string): string {
  const sep = ' <span class="vn-sep">·</span> '
  const parts: string[] = ['<span class="vn-label">Version:</span>']
  parts.push(
    activeKey === 'latest'
      ? '<strong class="vn-active">latest</strong>'
      : '<a href="./engine-inputs.html">latest</a>'
  )
  for (const v of allSnapshotVersions) {
    parts.push(
      activeKey === v
        ? `<strong class="vn-active">v${v}</strong>`
        : `<a href="./engine-inputs-v${v}.html">v${v}</a>`
    )
  }
  parts.push(`<a href="${CHANGELOG_URL}" class="vn-changelog">changelog &#x2192;</a>`)
  return `<nav class="version-nav">${parts.join(sep)}</nav>`
}


const engineInputsHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <title>__PAGE_TITLE__</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Every input the rules engine accepts, with its definition, type, enum vocabulary, and policy citations — the source of truth to build a data model against." />
    <style>
      :root { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
      body { margin: 0; color: #1f2937; }
      .docs-nav { font-size: 14px; padding: 0.6rem 1.25rem; background: #f3f4f6;
        border-bottom: 1px solid #e5e7eb; display: flex; gap: 1rem; align-items: center; }
      .docs-nav strong { color: #1f2937; }
      .docs-nav a { color: #2563eb; text-decoration: none; }
      .docs-nav .spacer { flex: 1; }
      main { max-width: 56rem; margin: 0 auto; padding: 1rem 1.25rem 4rem; }
      .lede { font-size: 14px; line-height: 1.55; color: #374151; }
      .coverage { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;
        padding: 0.6rem 0.9rem; font-size: 13.5px; color: #92400e; margin: 0.8rem 0; }
      .controls { display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: center;
        position: sticky; top: 0; background: #fff; padding: 0.75rem 0; border-bottom: 1px solid #e5e7eb; z-index: 2; }
      .controls input, .controls select { padding: 0.45rem 0.6rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; }
      .controls input { flex: 1; min-width: 14rem; }
      .count { color: #6b7280; font-size: 13px; }
      h2.group { font-size: 1.05rem; margin: 1.8rem 0 0.4rem; color: #374151; }
      .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 0.8rem 1rem; margin: 0.6rem 0; }
      .card code.field { font-weight: 600; font-size: 0.95rem; }
      .badges { margin: 0.35rem 0 0.5rem; display: flex; gap: 0.35rem; flex-wrap: wrap; }
      .badge { font-size: 11.5px; padding: 0.1rem 0.5rem; border-radius: 999px; background: #f3f4f6; color: #374151; }
      .badge.kind-applicant { background: #dcfce7; color: #166534; }
      .badge.kind-derived { background: #dbeafe; color: #1e40af; }
      .badge.kind-reference { background: #f3e8ff; color: #6b21a8; }
      .badge.aligns { background: #ede9fe; color: #5b21b6; }
      .def { font-size: 14px; line-height: 1.5; }
      .note { font-size: 13px; color: #6b7280; font-style: italic; margin-top: 0.35rem; }
      .cite { font-size: 12.5px; color: #6b7280; margin-top: 0.4rem; }
      details.values { margin-top: 0.4rem; font-size: 13px; }
      details.values code { background: #f3f4f6; padding: 0 0.3rem; border-radius: 4px; }
      .hidden { display: none; }
      .schema-version { display: inline-block; font-size: 13px; font-weight: 500;
        padding: 0.15rem 0.55rem; border-radius: 999px; background: #dbeafe;
        color: #1e40af; margin-left: 0.6rem; vertical-align: middle; }
      .version-nav { font-size: 13px; color: #6b7280; margin: 0.5rem 0 1rem;
        display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; }
      .version-nav a { color: #2563eb; text-decoration: none; }
      .version-nav a:hover { text-decoration: underline; }
      .vn-label { font-weight: 500; color: #374151; }
      .vn-active { font-weight: 600; color: #1f2937; }
      .vn-sep { color: #d1d5db; }
      .vn-changelog { color: #6b7280 !important; }
    </style>
  </head>
  <body>
    <nav class="docs-nav">
      <a href="./eligibility-v2.html">v2 API</a>
      <strong>Engine inputs</strong>
      <a href="./dictionary.html">Legacy inputs</a>
      <span class="spacer"></span>
      <a href="./advanced.html">Advanced API</a>
      <a href="./explore.html">Target explorer →</a>
    </nav>
    <main>
      <h1>Engine inputs <span class="schema-version">Schema __VERSION__</span></h1>
      __VERSION_NAV__
      <p class="lede">Every input the rules engine accepts, with the rule authors'
      own definitions, enum vocabularies, and policy citations — generated from
      the rulesets. The rules engine is the source of truth: build a data model
      to match these fields. Each is tagged <strong>applicant</strong> (you send
      it), <strong>derived</strong> (you send an applicant-natural form like a
      date of birth and the engine computes its internal fact), or
      <strong>reference</strong> (an id/link). Also available as
      <a href="__JSON_HREF__">JSON</a>.</p>
      <p class="coverage">__COVERAGE__</p>
      <div class="controls">
        <input id="q" type="search" placeholder="Search fields and definitions…" />
        <select id="program">
          <option value="">All programs</option>
          <option>SNAP</option>
          <option>Medicaid</option>
        </select>
        <select id="kind">
          <option value="">All kinds</option>
          <option value="applicant">applicant</option>
          <option value="derived">derived</option>
          <option value="reference">reference</option>
        </select>
        <span class="count" id="count"></span>
      </div>
      <div id="list"></div>
    </main>
    <script id="data" type="application/json">__DATA__</script>
    <script>
      const data = JSON.parse(document.getElementById('data').textContent)
      const list = document.getElementById('list')
      const esc = (s) => s.replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))
      const citeText = (cs) => cs.map((c) => c.pages.length ? c.document + ' — ' + (c.pages.length > 1 ? 'pp. ' : 'p. ') + c.pages.join(', ') : c.document).join('; ')
      for (const group of data.groups) {
        const h = document.createElement('h2')
        h.className = 'group'; h.textContent = group.title
        list.appendChild(h)
        for (const f of group.fields) {
          const apiField = f.requestPath
          const card = document.createElement('div')
          card.className = 'card'
          card.dataset.text = (apiField + ' ' + f.name + ' ' + (f.definition || '')).toLowerCase()
          card.dataset.programs = f.programs.join(',')
          card.dataset.kind = f.kind
          const badges = [
            '<span class="badge">' + esc(f.type) + '</span>',
            ...f.programs.map((p) => '<span class="badge">' + p + '</span>'),
            '<span class="badge kind-' + f.kind + '">' + f.kind + '</span>',
          ].join('')
          let values = ''
          if (f.values) {
            values = '<details class="values"><summary>' + f.values.length + ' allowed values</summary><p>' +
              f.values.map((v) => '<code>' + esc(v) + '</code>').join(' ') + '</p></details>'
          }
          card.innerHTML =
            '<div><strong>' + esc(f.name) + '</strong></div>' +
            '<code class="field">' + esc(apiField) + '</code>' +
            '<div class="badges">' + badges + '</div>' +
            (f.definition ? '<div class="def">' + esc(f.definition) + '</div>' : '') +
            (f.derivation ? '<div class="note">Derived: ' + esc(f.derivation) + '</div>' : '') +
            values +
            (f.citations.length ? '<div class="cite">' + esc(citeText(f.citations)) + '</div>' : '') +
            '<div class="cite">engine path: <code>' + esc(f.enginePath) + '</code></div>'
          list.appendChild(card)
        }
      }
      const q = document.getElementById('q')
      const program = document.getElementById('program')
      const kind = document.getElementById('kind')
      const count = document.getElementById('count')
      function apply() {
        const term = q.value.toLowerCase().trim()
        let shown = 0
        for (const card of list.querySelectorAll('.card')) {
          const ok = (!term || card.dataset.text.includes(term)) &&
            (!program.value || card.dataset.programs.includes(program.value)) &&
            (!kind.value || card.dataset.kind === kind.value)
          card.classList.toggle('hidden', !ok)
          if (ok) shown++
        }
        for (const h of list.querySelectorAll('h2.group')) {
          let el = h.nextElementSibling, any = false
          while (el && el.tagName !== 'H2') {
            if (!el.classList.contains('hidden')) { any = true; break }
            el = el.nextElementSibling
          }
          h.classList.toggle('hidden', !any)
        }
        count.textContent = shown + ' fields'
      }
      q.addEventListener('input', apply)
      program.addEventListener('change', apply)
      kind.addEventListener('change', apply)
      apply()
    </script>
  </body>
</html>
`
function renderEngineInputsPage(
  data: typeof engine,
  opts: { pageTitle: string; activeKey: 'latest' | string; jsonHref: string }
): string {
  return engineInputsHtml
    .replace('__PAGE_TITLE__', opts.pageTitle)
    .replace('__VERSION__', data.schemaVersion)
    .replace('__VERSION_NAV__', buildVersionNav(opts.activeKey))
    .replace('__COVERAGE__', data.coverage)
    .replace('__JSON_HREF__', opts.jsonHref)
    .replace('__DATA__', JSON.stringify(data).replace(/</g, '\\u003c'))
}

writeFileSync(
  `${outDir}/engine-inputs.html`,
  renderEngineInputsPage(engine, {
    pageTitle: 'Engine inputs — Eligibility Adapter API',
    activeKey: 'latest',
    jsonHref: './engine-inputs.json',
  })
)

// Historical versioned pages — one per committed snapshot.
for (const { version, data } of versionedSnapshots) {
  writeFileSync(`${outDir}/engine-inputs-v${version}.json`, JSON.stringify(data, null, 2))
  writeFileSync(
    `${outDir}/engine-inputs-v${version}.html`,
    renderEngineInputsPage(data, {
      pageTitle: `Engine inputs v${version} — Eligibility Adapter API`,
      activeKey: version,
      jsonHref: `./engine-inputs-v${version}.json`,
    })
  )
}

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
