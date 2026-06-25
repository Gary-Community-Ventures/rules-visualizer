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

// ---------------------------------------------------------------------------
// Shared nav — identical structure on every page. Grouped into two
// dropdowns (v2, v1 frozen) + right-side dev tools.
// ---------------------------------------------------------------------------
type NavPage = 'v2' | 'engine-inputs' | 'v1' | 'legacy-inputs' | 'advanced' | 'guide' | 'demo'

function buildDocsNav(active: NavPage): string {
  const inV2 = active === 'v2' || active === 'engine-inputs' || active === 'guide' || active === 'demo'
  const inV1 = active === 'v1' || active === 'legacy-inputs'
  const item = (href: string, label: string, key: NavPage) =>
    active === key
      ? `<strong class="nav-current">${label}</strong>`
      : `<a href="${href}">${label}</a>`
  return `<style>
  .docs-nav { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 14px; padding: 0.6rem 1.25rem; background: #f3f4f6;
    border-bottom: 1px solid #e5e7eb; display: flex; gap: 0.75rem; align-items: center; }
  .docs-nav a { color: #2563eb; text-decoration: none; }
  .docs-nav a:hover { text-decoration: underline; }
  .docs-nav .spacer { flex: 1; }
  .nav-group { position: relative; display: inline-block; }
  .nav-group-btn { background: none; border: none; cursor: pointer; padding: 0;
    font: inherit; font-size: 14px; color: #2563eb; display: flex; align-items: center; gap: 0.2rem; }
  .nav-group-btn:hover { text-decoration: underline; }
  .nav-group-btn.in-group { font-weight: 600; color: #1f2937; }
  .nav-group-menu { display: none; position: absolute; top: 100%; left: 0;
    background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.08); padding: 0.6rem 0 0.3rem; min-width: 150px; z-index: 20; }
  .nav-group:hover .nav-group-menu,
  .nav-group:focus-within .nav-group-menu { display: block; }
  .nav-group-menu a, .nav-group-menu .nav-current { display: block;
    padding: 0.4rem 0.85rem; font-size: 13.5px; white-space: nowrap; }
  .nav-group-menu a { color: #2563eb; text-decoration: none; }
  .nav-group-menu a:hover { background: #f9fafb; }
  .nav-group-menu .nav-current { color: #111827; font-weight: 600; }
  .nav-sep { color: #d1d5db; user-select: none; }
  .nav-advanced a { color: #6b7280; }
  .nav-advanced a:hover { color: #374151; text-decoration: underline; }
</style>
<nav class="docs-nav">
  <div class="nav-group">
    <button class="nav-group-btn${inV2 ? ' in-group' : ''}" type="button">
      API <span aria-hidden="true">▾</span>
    </button>
    <div class="nav-group-menu">
      ${item('./guide.html', 'Guide', 'guide')}
      ${item('./demo.html', 'Demo', 'demo')}
      ${item('./eligibility-v2.html', 'Reference', 'v2')}
      ${item('./engine-inputs.html', 'Inputs', 'engine-inputs')}
    </div>
  </div>
  <span class="nav-sep">│</span>
  <div class="nav-group">
    <button class="nav-group-btn${inV1 ? ' in-group' : ''}" type="button">
      Legacy API <span aria-hidden="true">▾</span>
    </button>
    <div class="nav-group-menu">
      ${item('./index.html', 'Reference', 'v1')}
      ${item('./dictionary.html', 'Inputs', 'legacy-inputs')}
    </div>
  </div>
  <span class="spacer"></span>
  <span class="nav-advanced">
    ${item('./advanced.html', 'Advanced API', 'advanced')}
    <a href="./explore.html">Target explorer →</a>
  </span>
</nav>`
}

// Redoc is loaded from a CDN — no build step.
function redocPage(opts: {
  title: string
  here: NavPage
  specUrl: string
  description: string
}): string {
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
      redoc { display: block; height: calc(100vh - 2.75rem); }
    </style>
  </head>
  <body>
    ${buildDocsNav(opts.here)}
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
    ${buildDocsNav('legacy-inputs')}
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
    __NAV__
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
    .replace('__NAV__', buildDocsNav('engine-inputs'))
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

// ---------------------------------------------------------------------------
// Integration guide — prose + live sandbox for new integrators.
// ---------------------------------------------------------------------------

const PROD_API = 'https://rules-visualizer-factgraph-api-f0c14673cf3a.herokuapp.com'

const guideHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <title>Integration guide — Eligibility API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Step-by-step guide to integrating the no-guess Eligibility API: missingInputs, per-member attribution, and the live sandbox." />
    <style>
      :root { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1f2937; }
      body { margin: 0; }
      main { max-width: 52rem; margin: 0 auto; padding: 1.5rem 1.25rem 5rem; }
      h1 { font-size: 1.6rem; margin: 1.25rem 0 0.35rem; }
      h2 { font-size: 1.15rem; margin: 2.5rem 0 0.6rem; padding-bottom: 0.3rem; border-bottom: 1px solid #e5e7eb; }
      h3 { font-size: 1rem; margin: 1.5rem 0 0.4rem; color: #374151; }
      p { line-height: 1.65; margin: 0.5rem 0; }
      a { color: #2563eb; }
      code { font-family: ui-monospace, "Cascadia Code", "Fira Mono", monospace; font-size: 0.88em;
        background: #f3f4f6; padding: 0.1em 0.35em; border-radius: 4px; }
      .lead { font-size: 1.05rem; color: #374151; margin-bottom: 1.5rem; }
      .example { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1rem 0; }
      @media (max-width: 640px) { .example { grid-template-columns: 1fr; } }
      .example-col { }
      .example-col h4 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em;
        color: #6b7280; margin: 0 0 0.3rem; }
      pre { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px;
        padding: 0.9rem 1rem; font-size: 0.82rem; line-height: 1.55; overflow-x: auto;
        margin: 0; white-space: pre; }
      pre .k { color: #7c3aed; }
      pre .s { color: #059669; }
      pre .n { color: #b45309; }
      pre .c { color: #6b7280; font-style: italic; }
      .pill { display: inline-block; font-size: 11.5px; padding: 0.15rem 0.55rem;
        border-radius: 999px; font-weight: 600; }
      .pill-pending  { background: #fef3c7; color: #92400e; }
      .pill-approved { background: #d1fae5; color: #065f46; }
      .pill-ineligible { background: #fee2e2; color: #991b1b; }
      .callout { background: #eff6ff; border-left: 3px solid #2563eb; border-radius: 0 6px 6px 0;
        padding: 0.75rem 1rem; margin: 1rem 0; font-size: 0.94rem; }
      .callout.warn { background: #fffbeb; border-color: #f59e0b; }
      .field-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; margin: 0.75rem 0; }
      .field-table th { text-align: left; padding: 0.4rem 0.6rem; background: #f9fafb;
        border-bottom: 2px solid #e5e7eb; color: #374151; }
      .field-table td { padding: 0.4rem 0.6rem; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
      .field-table td:first-child { font-family: ui-monospace, monospace; font-size: 0.82rem; color: #7c3aed; }

      /* ---- sandbox ---- */
      .sandbox { border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; margin: 1.25rem 0; }
      .sandbox-head { background: #f9fafb; padding: 0.75rem 1rem; border-bottom: 1px solid #e5e7eb;
        display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center; }
      .sandbox-head label { font-size: 13px; color: #374151; }
      .sandbox-head input, .sandbox-head select {
        padding: 0.35rem 0.6rem; border: 1px solid #d1d5db; border-radius: 6px;
        font-size: 13px; background: #fff; }
      .sandbox-head input.url { flex: 1; min-width: 18rem; font-family: ui-monospace, monospace; font-size: 12px; }
      .sandbox-body { display: grid; grid-template-columns: 1fr 1fr; }
      @media (max-width: 640px) { .sandbox-body { grid-template-columns: 1fr; } }
      .sandbox-pane { padding: 0.75rem 1rem; }
      .sandbox-pane + .sandbox-pane { border-left: 1px solid #e5e7eb; }
      .sandbox-pane h4 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em;
        color: #6b7280; margin: 0 0 0.4rem; }
      .sandbox-examples { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.6rem; }
      .ex-btn { font-size: 12px; padding: 0.25rem 0.65rem; border: 1px solid #d1d5db;
        border-radius: 6px; background: #fff; cursor: pointer; color: #374151; }
      .ex-btn:hover { background: #f3f4f6; }
      textarea#req-body { width: 100%; box-sizing: border-box; height: 240px; resize: vertical;
        font-family: ui-monospace, monospace; font-size: 12px; line-height: 1.5;
        border: 1px solid #e5e7eb; border-radius: 6px; padding: 0.6rem; color: #1f2937;
        background: #fff; }
      .send-row { display: flex; gap: 0.6rem; align-items: center; margin-top: 0.5rem; }
      button#send-btn { padding: 0.4rem 1.1rem; background: #2563eb; color: #fff;
        border: none; border-radius: 6px; font-size: 13px; cursor: pointer; font-weight: 600; }
      button#send-btn:hover { background: #1d4ed8; }
      button#send-btn:disabled { background: #93c5fd; cursor: default; }
      #resp-status { font-size: 12px; color: #6b7280; }
      pre#resp-body { height: 280px; overflow-y: auto; overflow-x: hidden; margin: 0;
        font-size: 0.78rem; white-space: pre-wrap; word-break: break-word; }
    </style>
  </head>
  <body>
    ${buildDocsNav('guide')}
    <main>
      <h1>Integration guide</h1>
      <p class="lead">
        This guide walks through calling the Eligibility API from first request to a resolved
        determination. The <a href="./eligibility-v2.html">API reference</a> and
        <a href="./engine-inputs.html">field catalog</a> are the companion documents.
      </p>

      <h2>The no-guess contract</h2>
      <p>
        The API never fills in missing information on your behalf. Every absent field is
        treated as <em>unknown</em>, not as a default. When the engine cannot reach a
        decision because required inputs are missing, the determination comes back as
        <span class="pill pill-pending">pending</span> with a <code>missingInputs</code> list
        naming exactly what to supply next, in the same request vocabulary you used to call the
        API.
      </p>
      <p>
        This means you can drive your own intake form from the API response rather than
        maintaining a separate field list. Start with whatever you have, read the
        <code>missingInputs</code>, and iterate until the status is
        <span class="pill pill-approved">approved</span> or
        <span class="pill pill-ineligible">ineligible</span>.
      </p>

      <h2>A first request</h2>
      <p>
        Send a minimal body — just a member with a date of birth. The response will be
        <span class="pill pill-pending">pending</span> and tell you exactly what else the
        engine needs.
      </p>
      <div class="example">
        <div class="example-col">
          <h4>Request</h4>
          <pre>{
  <span class="k">"members"</span>: [
    {
      <span class="k">"id"</span>: <span class="s">"alice"</span>,
      <span class="k">"dateOfBirth"</span>: <span class="s">"1990-03-15"</span>
    }
  ]
}</pre>
        </div>
        <div class="example-col">
          <h4>Response (abbreviated)</h4>
          <pre>{
  <span class="k">"asOf"</span>: <span class="s">"2026-06-11"</span>,
  <span class="k">"determinations"</span>: [{
    <span class="k">"program"</span>: <span class="s">"snap"</span>,
    <span class="k">"status"</span>: <span class="s">"pending"</span>,
    <span class="k">"missingInputs"</span>: [
      {
        <span class="k">"requestPath"</span>: <span class="s">"members[].income[].type"</span>,
        <span class="k">"field"</span>: <span class="s">"type"</span>,
        <span class="k">"location"</span>: <span class="s">"members[].income[]"</span>,
        <span class="k">"label"</span>: <span class="s">"Income type"</span>,
        <span class="k">"type"</span>: <span class="s">"Enum"</span>,
        <span class="k">"options"</span>: [<span class="s">"wages_and_salaries"</span>, ...]
      },
      <span class="c">// … more fields</span>
    ]
  }]
}</pre>
        </div>
      </div>

      <h2>Reading a missingInputs entry</h2>
      <p>Each entry in <code>missingInputs</code> tells you where to set the value:</p>
      <table class="field-table">
        <thead><tr><th>Field</th><th>What it means</th><th>Example</th></tr></thead>
        <tbody>
          <tr><td>requestPath</td><td>Dot-bracket path in the request where this value lives.</td><td><code>members[].income[].amount</code></td></tr>
          <tr><td>field</td><td>The leaf field name.</td><td><code>amount</code></td></tr>
          <tr><td>location</td><td>The collection or object that contains this field.</td><td><code>members[].income[]</code></td></tr>
          <tr><td>label</td><td>Human-readable display name from the rule author.</td><td><code>Gross income amount</code></td></tr>
          <tr><td>type</td><td>Data type: <code>Dollar</code>, <code>Boolean</code>, <code>Enum</code>, <code>Int</code>, etc.</td><td><code>Dollar</code></td></tr>
          <tr><td>options</td><td>Present when type is <code>Enum</code> — the allowed values.</td><td><code>["wages_and_salaries", "self_employment", …]</code></td></tr>
        </tbody>
      </table>
      <div class="callout">
        <strong>Setting a value at requestPath</strong> — for a path like
        <code>members[].income[].amount</code>, add an <code>income</code> row to the
        relevant member object with <code>"amount": 1200</code>. The brackets indicate
        the value lives inside a collection row.
      </div>

      <h2>Iterating toward a determination</h2>
      <p>
        Add the fields the engine asked for and resubmit. Each round should produce a shorter
        <code>missingInputs</code> list until the status resolves.
      </p>
      <div class="example">
        <div class="example-col">
          <h4>Round 2 — add income</h4>
          <pre>{
  <span class="k">"members"</span>: [{
    <span class="k">"id"</span>: <span class="s">"alice"</span>,
    <span class="k">"dateOfBirth"</span>: <span class="s">"1990-03-15"</span>,
    <span class="k">"income"</span>: [{
      <span class="k">"type"</span>: <span class="s">"wages_and_salaries"</span>,
      <span class="k">"amount"</span>: <span class="n">1200</span>,
      <span class="k">"frequency"</span>: <span class="s">"monthly"</span>
    }]
  }]
}</pre>
        </div>
        <div class="example-col">
          <h4>Asserting no income</h4>
          <p style="font-size:0.9rem; margin:0 0 0.5rem">
            Pass an explicit empty array to tell the engine this member has no income.
            Omitting the field entirely means <em>unknown</em> (still pending);
            <code>income: []</code> means <em>no rows</em> and resolves that branch.
          </p>
          <pre>{
  <span class="k">"members"</span>: [{
    <span class="k">"id"</span>: <span class="s">"alice"</span>,
    <span class="k">"dateOfBirth"</span>: <span class="s">"1990-03-15"</span>,
    <span class="k">"income"</span>: [],    <span class="c">// no income</span>
    <span class="k">"expenses"</span>: []  <span class="c">// no expenses</span>
  }]
}</pre>
        </div>
      </div>

      <h2>Per-member inputs — missingInputsByMember</h2>
      <p>
        When members are provided, the response also includes
        <code>missingInputsByMember</code>: a breakdown of which fields are missing
        for each specific member. This lets you show targeted prompts per person rather
        than a flat combined list.
      </p>
      <div class="example">
        <div class="example-col">
          <h4>Request — two members, one field gap</h4>
          <pre>{
  <span class="k">"members"</span>: [
    {
      <span class="k">"id"</span>: <span class="s">"alice"</span>,
      <span class="k">"dateOfBirth"</span>: <span class="s">"1990-03-15"</span>,
      <span class="k">"citizenshipImmigrationStatus"</span>:
        <span class="s">"citizen"</span>
    },
    {
      <span class="k">"id"</span>: <span class="s">"bob"</span>,
      <span class="k">"dateOfBirth"</span>: <span class="s">"1985-06-20"</span>
      <span class="c">// citizenshipImmigrationStatus absent</span>
    }
  ]
}</pre>
        </div>
        <div class="example-col">
          <h4>Response — bob needs citizenship, alice does not</h4>
          <pre>{
  <span class="k">"determinations"</span>: [{
    <span class="k">"status"</span>: <span class="s">"pending"</span>,
    <span class="k">"missingInputsByMember"</span>: {
      <span class="k">"alice"</span>: [
        <span class="c">// citizenshipImmigrationStatus not here</span>
        <span class="c">// (alice already provided it)</span>
      ],
      <span class="k">"bob"</span>: [
        {
          <span class="k">"requestPath"</span>:
            <span class="s">"members[].citizenshipImmigrationStatus"</span>,
          <span class="k">"field"</span>: <span class="s">"citizenshipImmigrationStatus"</span>,
          <span class="k">"label"</span>: <span class="s">"Citizenship / immigration status"</span>,
          <span class="k">"type"</span>: <span class="s">"Enum"</span>,
          <span class="k">"options"</span>: [<span class="s">"citizen"</span>, ...]
        }
      ]
    }
  }]
}</pre>
        </div>
      </div>
      <div class="callout">
        <strong>Income rows are attributed to the member who contributed them.</strong>
        If alice provides an income row missing <code>amount</code>, that field appears in
        <code>missingInputsByMember.alice</code> but not in bob's list. A member with no
        income rows at all does not receive income-row fields — they appear only in the
        top-level <code>missingInputs</code> union.
      </div>

      <h2>Resolved determinations</h2>
      <p>
        Once the engine has enough information the status moves to
        <span class="pill pill-approved">approved</span> or
        <span class="pill pill-ineligible">ineligible</span>/<code>denied</code>.
        At that point <code>missingInputs</code> is absent.
      </p>
      <div class="example">
        <div class="example-col">
          <h4>Approved — SNAP household</h4>
          <pre>{
  <span class="k">"determinations"</span>: [{
    <span class="k">"program"</span>: <span class="s">"snap"</span>,
    <span class="k">"scope"</span>: <span class="s">"household"</span>,
    <span class="k">"status"</span>: <span class="s">"approved"</span>,
    <span class="k">"benefitAmount"</span>: <span class="n">291</span>,
    <span class="k">"isExpedited"</span>: <span class="n">false</span>
  }]
}</pre>
        </div>
        <div class="example-col">
          <h4>Ineligible — over income limit</h4>
          <pre>{
  <span class="k">"determinations"</span>: [{
    <span class="k">"program"</span>: <span class="s">"snap"</span>,
    <span class="k">"scope"</span>: <span class="s">"household"</span>,
    <span class="k">"status"</span>: <span class="s">"ineligible"</span>,
    <span class="k">"denialReasonCode"</span>:
      <span class="s">"gross_income_over_limit"</span>,
    <span class="k">"explanation"</span>: [...]
  }]
}</pre>
        </div>
      </div>

      <h2>Live sandbox</h2>
      <p>
        Send a real request to the API from your browser. The production endpoint is
        pre-filled; swap in <code>http://localhost:5002</code> to test against a local
        server. Local dev does not require auth — leave the token blank. The production
        server requires a bearer token; enter it below if you have one.
      </p>
      <div class="sandbox">
        <div class="sandbox-head">
          <label>Endpoint
            <select id="prog-select">
              <option value="/v2/eligibility/snap/determination">SNAP determination</option>
              <option value="/v2/eligibility/snap/expedited-screening">SNAP expedited screen</option>
              <option value="/v2/eligibility/medicaid/determination">Medicaid determination</option>
            </select>
          </label>
          <label style="flex:1">Base URL
            <input class="url" id="api-url" value="${PROD_API}" />
          </label>
          <label>Bearer token (optional)
            <input id="api-token" type="password" placeholder="leave blank if not required" style="width:14rem" />
          </label>
        </div>
        <div class="sandbox-body">
          <div class="sandbox-pane">
            <h4>Request body</h4>
            <div class="sandbox-examples">
              <button class="ex-btn" data-ex="empty">Empty body</button>
              <button class="ex-btn" data-ex="minimal">One member</button>
              <button class="ex-btn" data-ex="income">With income</button>
              <button class="ex-btn" data-ex="noincome">No income (explicit)</button>
              <button class="ex-btn" data-ex="twomembers">Two members</button>
            </div>
            <textarea id="req-body">{}</textarea>
            <div class="send-row">
              <button id="send-btn">Send →</button>
              <span id="resp-status"></span>
            </div>
          </div>
          <div class="sandbox-pane">
            <h4>Response</h4>
            <pre id="resp-body" style="color:#6b7280">Response will appear here.</pre>
          </div>
        </div>
      </div>

      <p style="font-size:0.88rem; color:#6b7280; margin-top:2rem">
        Full field list and enum vocabularies: <a href="./engine-inputs.html">engine inputs catalog</a>.
        API shape: <a href="./eligibility-v2.html">reference</a>.
      </p>
    </main>
    <script>
      const EXAMPLES = {
        empty: '{}',
        minimal: JSON.stringify({
          members: [{ id: 'alice', dateOfBirth: '1990-03-15' }]
        }, null, 2),
        income: JSON.stringify({
          members: [{
            id: 'alice', dateOfBirth: '1990-03-15',
            income: [{ type: 'wages_and_salaries', amount: 1200, frequency: 'monthly' }]
          }]
        }, null, 2),
        noincome: JSON.stringify({
          members: [{ id: 'alice', dateOfBirth: '1990-03-15', income: [], expenses: [] }]
        }, null, 2),
        twomembers: JSON.stringify({
          members: [
            { id: 'alice', dateOfBirth: '1990-03-15', citizenshipImmigrationStatus: 'citizen',
              income: [{ type: 'wages_and_salaries', amount: 1200, frequency: 'monthly' }] },
            { id: 'bob', dateOfBirth: '1985-06-20' }
          ]
        }, null, 2),
      }

      document.querySelectorAll('.ex-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.getElementById('req-body').value = EXAMPLES[btn.dataset.ex] ?? '{}'
        })
      })

      document.getElementById('send-btn').addEventListener('click', async () => {
        const btn = document.getElementById('send-btn')
        const statusEl = document.getElementById('resp-status')
        const respEl = document.getElementById('resp-body')
        const base = document.getElementById('api-url').value.replace(/\\/$/, '')
        const path = document.getElementById('prog-select').value
        const token = document.getElementById('api-token').value.trim()

        let body
        try { body = JSON.parse(document.getElementById('req-body').value) }
        catch (e) { statusEl.textContent = 'Invalid JSON: ' + e.message; return }

        btn.disabled = true
        statusEl.textContent = 'Sending...'
        respEl.style.color = '#6b7280'
        respEl.textContent = ''

        try {
          const headers = { 'Content-Type': 'application/json' }
          if (token) {
            if ([...token].some(c => c.charCodeAt(0) > 255)) {
              statusEl.textContent = 'Token contains non-ASCII characters -- check for copy-paste artifacts (curly quotes, Unicode dashes)'
              btn.disabled = false
              return
            }
            headers['Authorization'] = 'Bearer ' + token
          }
          const res = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) })
          statusEl.textContent = 'HTTP ' + res.status + (res.ok ? ' OK' : ' ' + res.statusText)
          const text = await res.text()
          let display
          try {
            display = JSON.stringify(JSON.parse(text), null, 2)
          } catch {
            display = text || '(empty response body)'
          }
          respEl.style.color = res.ok ? '#1f2937' : '#991b1b'
          respEl.textContent = display
        } catch (e) {
          statusEl.textContent = 'Network error'
          respEl.style.color = '#991b1b'
          respEl.textContent = e.message + '\\n\\nIf the server is not responding, it may be waking up -- wait a moment and try again.'
        } finally {
          btn.disabled = false
        }
      })
    </script>
  </body>
</html>
`
writeFileSync(`${outDir}/guide.html`, guideHtml)

// ---------------------------------------------------------------------------
// Convergence demo — interactive walkthrough that reveals missingInputs
// progressively as the user fills fields, showing resolved vs still-needed
// in real time.
// ---------------------------------------------------------------------------
const demoHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Eligibility demo</title>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${buildDocsNav('demo')}
  <style>
    body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: #f9fafb; margin: 0; }
    .demo-wrap { max-width: 860px; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
    h1 { font-size: 1.45rem; font-weight: 700; margin: 0 0 0.3rem; color: #111827; }
    .lede { font-size: 0.95rem; color: #4b5563; margin: 0 0 1.25rem; }

    /* config bar */
    .config-bar { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: flex-end;
      background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
      padding: 0.75rem 1rem; margin-bottom: 1.25rem; font-size: 13px; }
    .config-bar label { display: flex; flex-direction: column; gap: 3px; color: #374151; font-weight: 500; }
    .config-bar input { padding: 0.3rem 0.55rem; border: 1px solid #d1d5db;
      border-radius: 5px; font-size: 12px; font-family: ui-monospace, monospace; }
    .config-bar .url-in { width: 22rem; }
    .config-bar .tok-in { width: 14rem; }
    .config-bar button { padding: 0.35rem 0.9rem; border: 1px solid #d1d5db; border-radius: 5px;
      background: #fff; cursor: pointer; font-size: 13px; color: #374151; align-self: flex-end; }
    .config-bar button:hover { background: #f3f4f6; }

    /* program tabs */
    .prog-tabs { display: flex; gap: 0.5rem; margin-bottom: 1.25rem; }
    .prog-tab { padding: 0.4rem 1rem; border: 1px solid #d1d5db; border-radius: 6px;
      background: #fff; cursor: pointer; font-size: 13px; font-weight: 500; color: #374151; }
    .prog-tab.active { background: #2563eb; color: #fff; border-color: #2563eb; }
    .prog-tab:hover:not(.active) { background: #f3f4f6; }

    /* status row */
    .status-row { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.25rem;
      min-height: 2rem; }
    .status-badge { font-size: 0.82rem; font-weight: 700; padding: 0.3rem 0.85rem;
      border-radius: 6px; text-transform: uppercase; letter-spacing: 0.05em; }
    .s-pending  { background: #dbeafe; color: #1d4ed8; }
    .s-approved { background: #d1fae5; color: #065f46; }
    .s-denied, .s-ineligible { background: #fee2e2; color: #991b1b; }
    .s-null, .s-loading { background: #f3f4f6; color: #9ca3af; }
    .s-error    { background: #fff7ed; color: #92400e; }
    .progress-line { font-size: 0.85rem; color: #6b7280; }
    .prog-res  { color: #059669; font-weight: 600; }
    .prog-need { color: #2563eb; }

    /* field groups */
    .field-group { margin-bottom: 1.5rem; }
    .field-group-label { font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.07em; color: #9ca3af; margin: 0 0 0.55rem; }
    .field-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 0.55rem; }

    /* field cards */
    .field-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 0.65rem 0.8rem;
      background: #fff; transition: border-color 0.2s, background 0.2s, opacity 0.3s; }
    .field-card-needed     { border-color: #93c5fd; background: #eff6ff; }
    .field-card-still-needed  { border-color: #fcd34d; background: #fffbeb; }
    .field-card-resolved      { border-color: #a7f3d0; background: #f0fdf4; }
    .field-card-auto-resolved { border-color: #e5e7eb; background: #f9fafb; opacity: 0.55; }
    .field-card-header { display: flex; justify-content: space-between; align-items: flex-start;
      gap: 0.4rem; margin-bottom: 0.45rem; }
    .field-label { font-size: 0.81rem; font-weight: 600; color: #111827; line-height: 1.3; }
    .field-badge { font-size: 0.62rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.04em; padding: 0.13rem 0.38rem; border-radius: 4px; white-space: nowrap; flex-shrink: 0; }
    .b-needed      { background: #dbeafe; color: #1e40af; }
    .b-still-needed   { background: #fef3c7; color: #92400e; }
    .b-resolved       { background: #d1fae5; color: #065f46; }
    .b-auto-resolved  { background: #f3f4f6; color: #9ca3af; }

    /* inputs */
    .field-card input[type=text],
    .field-card input[type=date],
    .field-card input[type=number],
    .field-card select {
      width: 100%; box-sizing: border-box; padding: 0.28rem 0.45rem;
      border: 1px solid #d1d5db; border-radius: 5px; font-size: 13px;
      background: #fff; color: #111827; font-family: inherit; }
    .field-card-resolved input,
    .field-card-resolved select { background: #f0fdf4; }
    .field-card-auto-resolved input,
    .field-card-auto-resolved select { background: #f9fafb; color: #9ca3af; }
    .bool-btns { display: flex; gap: 0.35rem; flex-wrap: wrap; }
    .bool-btn { padding: 0.28rem 0.7rem; border: 1px solid #d1d5db; border-radius: 5px;
      background: #fff; cursor: pointer; font-size: 12px; color: #374151; }
    .bool-btn.active { background: #2563eb; color: #fff; border-color: #2563eb; }
    .bool-btn:hover:not(.active) { background: #f3f4f6; }
    .bool-btn.clr { border-color: #e5e7eb; color: #9ca3af; padding: 0.28rem 0.45rem; }
    .num-wrap { display: flex; align-items: stretch; }
    .num-affix { font-size: 13px; color: #6b7280; background: #f3f4f6;
      border: 1px solid #d1d5db; padding: 0.28rem 0.4rem; display: flex; align-items: center; }
    .num-affix.pre { border-right: none; border-radius: 5px 0 0 5px; }
    .num-affix.suf { border-left: none; border-radius: 0 5px 5px 0; }
    .num-wrap input { border-radius: 0; flex: 1; min-width: 0; }
    .num-wrap:not(:has(.pre)) input { border-radius: 5px 0 0 5px; }
    .field-note { font-size: 0.78rem; color: #9ca3af; font-style: italic; }
    .input-resolved input, .input-resolved select, .input-resolved .bool-btn { pointer-events: none; }
    .input-auto-resolved input, .input-auto-resolved select, .input-auto-resolved .bool-btn { pointer-events: none; }
    .fields-hint { color: #9ca3af; font-size: 0.9rem; text-align: center; padding: 2.5rem 0; }

    /* response details */
    details { margin-top: 1.5rem; }
    details summary { font-size: 0.82rem; color: #6b7280; cursor: pointer; user-select: none; }
    details summary:hover { color: #374151; }
    pre#raw-resp { font-size: 0.72rem; background: #f8fafc; border: 1px solid #e5e7eb;
      border-radius: 6px; padding: 0.75rem; overflow-x: hidden; white-space: pre-wrap;
      word-break: break-word; max-height: 300px; overflow-y: auto; margin-top: 0.5rem; }
  </style>
</head>
<body>
<div class="demo-wrap">
  <h1>Eligibility walkthrough</h1>
  <p class="lede">
    Fill in fields and watch the determination converge. Each API call returns exactly which
    inputs are still needed — resolved fields turn green, new ones may appear as others are filled.
  </p>

  <div class="config-bar">
    <label>Base URL
      <input id="base-url" class="url-in" value="${PROD_API}" />
    </label>
    <label>Bearer token
      <input id="api-token" class="tok-in" type="password" placeholder="leave blank for local dev" />
    </label>
    <button id="reset-btn" title="Clear all values and restart">Reset</button>
  </div>

  <div class="prog-tabs">
    <button class="prog-tab active" data-prog="snap">SNAP</button>
    <button class="prog-tab" data-prog="medicaid">Medicaid</button>
    <button class="prog-tab" data-prog="expedited">SNAP expedited screen</button>
  </div>

  <div class="status-row">
    <span id="status-badge" class="status-badge s-null">—</span>
    <span id="progress-line" class="progress-line"></span>
  </div>

  <div id="fields-container">
    <p class="fields-hint">Loading initial inputs...</p>
  </div>

  <details>
    <summary>Last API response</summary>
    <pre id="raw-resp"></pre>
  </details>
</div>
<script>
  var PROD = '${PROD_API}'
  var ENDPOINTS = {
    snap:      '/v2/eligibility/snap/determination',
    medicaid:  '/v2/eligibility/medicaid/determination',
    expedited: '/v2/eligibility/snap/expedited-screening'
  }
  var LOC_LABELS = {
    'members[]':           'Person',
    'household':           'Household',
    'members[].income[]':  'Income',
    'members[].expenses[]':'Expenses',
    'members[].jobs[]':    'Jobs',
    'members[].assets[]':  'Assets'
  }
  var LOC_ORDER = Object.keys(LOC_LABELS)
  var SKIP_LOCS = { 'caregiverRelationships[]': true }

  // ---- state ----------------------------------------------------------------
  var program    = 'snap'
  var values     = {}    // requestPath -> coerced value
  var fieldCache = {}    // requestPath -> {field,label,location,type,options}
  var allSeen    = []    // requestPath in first-seen order
  var curMissing = new Set()
  var curStatus  = null
  var curDet     = null
  var debounce   = null
  var inflight   = false

  // ---- helpers --------------------------------------------------------------
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  }

  function coerce(raw, type) {
    if (type === 'Boolean') return raw === 'true'
    if (type === 'Int' || type === 'Dollar' || type === 'Percent') {
      var n = parseFloat(raw)
      return isNaN(n) ? undefined : n
    }
    return raw
  }

  function buildRequest() {
    var req = { members: [{ id: 'demo' }], caregiverRelationships: [] }
    Object.keys(values).forEach(function(path) {
      var val = values[path]
      if (val === undefined || val === null || val === '') return
      if (path.indexOf('household.') === 0) {
        req.household = req.household || {}
        req.household[path.slice(10)] = val
      } else if (path.indexOf('members[].') === 0) {
        var rest = path.slice(10)
        var m = rest.match(/^(\\w+)\\[\\]\\.(.+)$/)
        if (m) {
          var coll = m[1], field = m[2]
          req.members[0][coll] = req.members[0][coll] || [{}]
          req.members[0][coll][0][field] = val
        } else {
          req.members[0][rest] = val
        }
      }
    })
    return req
  }

  // ---- API call -------------------------------------------------------------
  function callApi() {
    var base = document.getElementById('base-url').value.replace(/\\/$/, '')
    var tok  = document.getElementById('api-token').value.trim()
    if (tok) {
      var bad = false
      for (var i = 0; i < tok.length; i++) { if (tok.charCodeAt(i) > 255) { bad = true; break } }
      if (bad) { showError('Token contains non-ASCII characters — check for copy-paste artifacts.'); return }
    }
    inflight = true
    renderStatus()
    var headers = { 'Content-Type': 'application/json' }
    if (tok) headers['Authorization'] = 'Bearer ' + tok
    fetch(base + ENDPOINTS[program], { method: 'POST', headers: headers, body: JSON.stringify(buildRequest()) })
      .then(function(r) { return r.json() })
      .then(function(data) {
        document.getElementById('raw-resp').textContent = JSON.stringify(data, null, 2)
        var det = (data.determinations && data.determinations[0]) ? data.determinations[0] : data
        curDet = det
        curStatus = det.status || null

        var missing = det.missingInputs || data.missingInputs || []
        var newSet = new Set()
        missing.forEach(function(m) {
          newSet.add(m.requestPath)
          if (!fieldCache[m.requestPath]) {
            allSeen.push(m.requestPath)
            fieldCache[m.requestPath] = { field: m.field, label: m.label, location: m.location, type: m.type, options: m.options || [] }
          }
        })
        curMissing = newSet
        inflight = false
        render()
      })
      .catch(function(e) {
        inflight = false
        showError(e.message)
      })
  }

  function showError(msg) {
    curStatus = 'error'
    document.getElementById('status-badge').className = 'status-badge s-error'
    document.getElementById('status-badge').textContent = msg
    document.getElementById('progress-line').textContent = ''
    inflight = false
  }

  // ---- field actions --------------------------------------------------------
  function setField(path, rawVal) {
    var meta = fieldCache[path]
    var coerced = (rawVal === '__clear__' || rawVal === '' || rawVal === undefined)
      ? undefined : meta ? coerce(rawVal, meta.type) : rawVal
    if (coerced === undefined) delete values[path]
    else values[path] = coerced
    // Update boolean button active states immediately
    var card = document.querySelector('[data-card="' + path + '"]')
    if (card) {
      card.querySelectorAll('.bool-btn[data-bval]').forEach(function(b) {
        var v = b.dataset.bval
        var cur = values[path]
        b.classList.toggle('active', (v === 'true' && cur === true) || (v === 'false' && cur === false))
      })
    }
    clearTimeout(debounce)
    debounce = setTimeout(callApi, 500)
  }

  function clearField(path) { setField(path, '__clear__') }

  // ---- program switch -------------------------------------------------------
  function setProgram(prog) {
    program = prog
    values = {}; fieldCache = {}; allSeen = []; curMissing = new Set()
    curStatus = null; curDet = null
    document.querySelectorAll('.prog-tab').forEach(function(b) {
      b.classList.toggle('active', b.dataset.prog === prog)
    })
    document.getElementById('fields-container').innerHTML = '<p class="fields-hint">Loading...</p>'
    callApi()
  }

  // ---- rendering ------------------------------------------------------------
  function fieldState(path) {
    var inMissing = curMissing.has(path)
    var hasVal = path in values
    if (inMissing && !hasVal)  return 'needed'
    if (inMissing &&  hasVal)  return 'still-needed'
    if (!inMissing && hasVal)  return 'resolved'
    if (!inMissing && !hasVal) return 'auto-resolved'
    return 'unknown'
  }

  function badgeText(s) {
    return s === 'needed'        ? 'needed'
      : s === 'still-needed'    ? 'still needed'
      : s === 'resolved'        ? '\\u2713 provided'
      : s === 'auto-resolved'   ? 'not needed'
      : ''
  }

  function buildInputHTML(path) {
    var m = fieldCache[path]
    if (!m) return ''
    var val = values[path]
    if (m.type === 'Boolean') {
      var t = val === true, f = val === false
      return '<div class="bool-btns">' +
        '<button class="bool-btn' + (t ? ' active' : '') + '" data-path="' + path + '" data-bval="true">Yes</button>' +
        '<button class="bool-btn' + (f ? ' active' : '') + '" data-path="' + path + '" data-bval="false">No</button>' +
        (val !== undefined ? '<button class="bool-btn clr" data-path="' + path + '" data-bval="__clear__">✕</button>' : '') +
        '</div>'
    }
    if (m.type === 'Enum' && m.options && m.options.length) {
      var opts = '<option value="">-- select --</option>'
      m.options.forEach(function(o) { opts += '<option value="' + esc(o) + '"' + (val === o ? ' selected' : '') + '>' + esc(o) + '</option>' })
      return '<select data-path="' + path + '">' + opts + '</select>'
    }
    if (m.type === 'Date' || m.type === 'Day') {
      return '<input type="date" data-path="' + path + '" value="' + esc(val || '') + '" />'
    }
    if (m.type === 'Int' || m.type === 'Dollar' || m.type === 'Percent') {
      var pre = m.type === 'Dollar'   ? '<span class="num-affix pre">$</span>' : ''
      var suf = m.type === 'Percent'  ? '<span class="num-affix suf">%</span>' : ''
      var step = m.type === 'Dollar'  ? '0.01' : '1'
      return '<div class="num-wrap">' + pre + '<input type="number" min="0" step="' + step + '" data-path="' + path + '" value="' + esc(val !== undefined ? val : '') + '" />' + suf + '</div>'
    }
    if (m.type === 'CollectionItem') return '<span class="field-note">member reference (use API directly)</span>'
    return '<input type="text" data-path="' + path + '" value="' + esc(val || '') + '" />'
  }

  function getOrCreateGroup(loc) {
    var gid = 'grp-' + loc.replace(/[^a-z0-9]/gi, '-')
    var g = document.getElementById(gid)
    if (!g) {
      var container = document.getElementById('fields-container')
      var hint = container.querySelector('.fields-hint')
      if (hint) hint.remove()
      g = document.createElement('div')
      g.className = 'field-group'
      g.id = gid
      var lbl = LOC_LABELS[loc] || loc
      g.innerHTML = '<h3 class="field-group-label">' + esc(lbl) + '</h3><div class="field-cards" id="cards-' + gid + '"></div>'
      // Insert in LOC_ORDER order
      var pos = LOC_ORDER.indexOf(loc)
      var inserted = false
      var groups = container.querySelectorAll('.field-group')
      for (var i = 0; i < groups.length; i++) {
        var otherLoc = groups[i].id.replace('grp-', '').replace(/-/g, function(_, o, s) {
          // reconstruct loc from id is fragile — just append
          return '-'
        })
        // simplified: just append in order groups appear
        if (!inserted && pos >= 0) {
          var otherPos = LOC_ORDER.findIndex(function(l) { return 'grp-' + l.replace(/[^a-z0-9]/gi, '-') === groups[i].id })
          if (otherPos > pos) { container.insertBefore(g, groups[i]); inserted = true; break }
        }
      }
      if (!inserted) container.appendChild(g)
    }
    return document.getElementById('cards-' + gid)
  }

  function renderNewFields() {
    var existing = new Set()
    document.querySelectorAll('[data-card]').forEach(function(el) { existing.add(el.dataset.card) })
    allSeen.forEach(function(path) {
      if (SKIP_LOCS[fieldCache[path] && fieldCache[path].location]) return
      if (existing.has(path)) return
      var loc = fieldCache[path] && fieldCache[path].location
      if (!loc) return
      var meta = fieldCache[path]
      var state = fieldState(path)
      var cardsEl = getOrCreateGroup(loc)
      var card = document.createElement('div')
      card.className = 'field-card field-card-' + state
      card.dataset.card = path
      card.innerHTML =
        '<div class="field-card-header">' +
          '<span class="field-label">' + esc(meta.label || path) + '</span>' +
          '<span class="field-badge b-' + state + '">' + badgeText(state) + '</span>' +
        '</div>' +
        '<div class="field-input' + (state === 'resolved' ? ' input-resolved' : state === 'auto-resolved' ? ' input-auto-resolved' : '') + '">' + buildInputHTML(path) + '</div>'
      cardsEl.appendChild(card)
    })
  }

  function updateFieldStates() {
    document.querySelectorAll('[data-card]').forEach(function(card) {
      var path = card.dataset.card
      var state = fieldState(path)
      card.className = 'field-card field-card-' + state
      var badge = card.querySelector('.field-badge')
      if (badge) { badge.className = 'field-badge b-' + state; badge.textContent = badgeText(state) }
      var inp = card.querySelector('.field-input')
      if (inp) inp.className = 'field-input' + (state === 'resolved' ? ' input-resolved' : state === 'auto-resolved' ? ' input-auto-resolved' : '')
    })
  }

  function renderStatus() {
    var badge = document.getElementById('status-badge')
    var prog  = document.getElementById('progress-line')
    if (inflight) { badge.className = 'status-badge s-loading'; badge.textContent = 'Loading...'; prog.textContent = ''; return }
    var s = curStatus || 'null'
    badge.className = 'status-badge s-' + s
    if (s === 'approved') {
      badge.textContent = 'Approved' + (curDet && curDet.benefitAmount ? ' — $' + curDet.benefitAmount + '/mo' : '')
    } else if (s === 'denied' || s === 'ineligible') {
      var code = curDet && curDet.denialReasonCode ? ': ' + curDet.denialReasonCode.replace(/_/g, ' ') : ''
      badge.textContent = (s === 'denied' ? 'Denied' : 'Ineligible') + code
    } else if (s === 'pending') {
      badge.textContent = 'Pending'
    } else if (s === 'null') {
      badge.textContent = '—'
    } else {
      badge.textContent = s
    }
    var provided     = allSeen.filter(function(p) { return !curMissing.has(p) && (p in values) && fieldCache[p] && !SKIP_LOCS[fieldCache[p].location] }).length
    var autoResolved = allSeen.filter(function(p) { return !curMissing.has(p) && !(p in values) && fieldCache[p] && !SKIP_LOCS[fieldCache[p].location] }).length
    var needed       = curMissing.size
    var parts = []
    if (provided > 0)     parts.push('<span class="prog-res">\\u2713 ' + provided + ' provided</span>')
    if (autoResolved > 0) parts.push('<span style="color:#9ca3af">' + autoResolved + ' not needed</span>')
    if (needed > 0)       parts.push('<span class="prog-need">' + needed + ' still needed</span>')
    if (parts.length > 0) {
      prog.innerHTML = parts.join(' &nbsp;&middot;&nbsp; ')
    } else {
      prog.textContent = ''
    }
  }

  function render() {
    renderStatus()
    renderNewFields()
    updateFieldStates()
  }

  // ---- event delegation -----------------------------------------------------
  var fc = document.getElementById('fields-container')
  fc.addEventListener('change', function(e) {
    var path = e.target.dataset && e.target.dataset.path
    if (!path) return
    setField(path, e.target.value)
  })
  fc.addEventListener('input', function(e) {
    var path = e.target.dataset && e.target.dataset.path
    if (!path || e.target.type !== 'number') return
    clearTimeout(debounce)
    debounce = setTimeout(function() { setField(path, e.target.value) }, 500)
  })
  fc.addEventListener('click', function(e) {
    var btn = e.target.closest && e.target.closest('button[data-bval]')
    if (!btn) return
    var path = btn.dataset.path, bval = btn.dataset.bval
    setField(path, bval)
  })

  // program tabs
  document.querySelector('.prog-tabs').addEventListener('click', function(e) {
    var btn = e.target.closest('.prog-tab')
    if (!btn) return
    setProgram(btn.dataset.prog)
  })

  // reset
  document.getElementById('reset-btn').addEventListener('click', function() {
    setProgram(program)
  })

  // ---- init -----------------------------------------------------------------
  callApi()
</script>
</body>
</html>
`
writeFileSync(`${outDir}/demo.html`, demoHtml)

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
