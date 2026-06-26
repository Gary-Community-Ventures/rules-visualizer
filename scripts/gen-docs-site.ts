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
      .pill-denied   { background: #fee2e2; color: #991b1b; }
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
        <span class="pill pill-approved">approved</span>,
        <span class="pill pill-denied">denied</span>, or
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
        <span class="pill pill-approved">approved</span>,
        <span class="pill pill-denied">denied</span>, or
        <span class="pill pill-ineligible">ineligible</span>.
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
          <h4>Denied — over income limit</h4>
          <pre>{
  <span class="k">"determinations"</span>: [{
    <span class="k">"program"</span>: <span class="s">"snap"</span>,
    <span class="k">"scope"</span>: <span class="s">"household"</span>,
    <span class="k">"status"</span>: <span class="s">"denied"</span>,
    <span class="k">"denialReasonCode"</span>:
      <span class="s">"failed_gross_income_test"</span>,
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
const fieldDescMap: Record<string, string> = {}
for (const group of engine.groups) {
  for (const f of (group as { fields: Array<{ requestPath: string; definition?: string; derivation?: string }> }).fields) {
    const desc = f.definition || f.derivation || ''
    if (desc) fieldDescMap[f.requestPath] = desc
  }
}

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
    .s-denied-partial, .s-ineligible-partial { background: #fef3c7; color: #92400e; }
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
    .field-path { font-size: 0.67rem; color: #9ca3af; font-family: ui-monospace, monospace;
      margin: 0.1rem 0 0.35rem; word-break: break-all; }
    .field-def { margin: 0 0 0.3rem; border: none; }
    .field-def summary { font-size: 0.72rem; color: #9ca3af; cursor: pointer; user-select: none;
      list-style: none; display: inline-flex; align-items: center; gap: 0.2rem; }
    .field-def summary::-webkit-details-marker { display: none; }
    .field-def summary::before { content: '\\2139'; font-style: normal; }
    .field-def[open] summary { color: #6b7280; }
    .field-def .def-body { font-size: 0.75rem; color: #6b7280; margin-top: 0.2rem;
      line-height: 1.45; padding: 0.4rem 0.5rem; background: #f8fafc;
      border-radius: 5px; border: 1px solid #e5e7eb; }
    .fields-hint { color: #9ca3af; font-size: 0.9rem; text-align: center; padding: 2.5rem 0; }

    /* response details */
    details { margin-top: 1.5rem; }
    details summary { font-size: 0.82rem; color: #6b7280; cursor: pointer; user-select: none; }
    details summary:hover { color: #374151; }
    pre#raw-resp { font-size: 0.72rem; background: #f8fafc; border: 1px solid #e5e7eb;
      border-radius: 6px; padding: 0.75rem; overflow-x: hidden; white-space: pre-wrap;
      word-break: break-word; max-height: 300px; overflow-y: auto; margin-top: 0.5rem; }

    /* member / collection layout */
    .member-section { border: 1px solid #e5e7eb; border-radius: 8px; background: #fff;
      margin-bottom: 1.25rem; }
    .member-header { display: flex; justify-content: space-between; align-items: center;
      padding: 0.6rem 0.85rem; border-bottom: 1px solid #f3f4f6; }
    .member-count-label { font-size: 0.8rem; font-weight: 700; color: #374151; }
    .member-fields { padding: 0.7rem 0.75rem 0.3rem; }
    .subcoll-section { border-top: 1px solid #f3f4f6; padding: 0.6rem 0.75rem 0.45rem; }
    .subcoll-header { display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 0.4rem; }
    .subcoll-label { font-size: 0.68rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.07em; color: #9ca3af; }
    .subcoll-needed-hint { font-size: 0.72rem; color: #1d4ed8; font-weight: 600; }
    .row-section { border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 0.4rem; }
    .row-header { display: flex; justify-content: space-between; align-items: center;
      padding: 0.3rem 0.6rem; background: #f9fafb; border-radius: 6px 6px 0 0;
      border-bottom: 1px solid #f3f4f6; }
    .row-header-label { font-size: 0.72rem; font-weight: 600; color: #6b7280; }
    .row-fields { padding: 0.5rem 0.6rem 0.25rem; }
    .household-section { margin-bottom: 1.25rem; }
    .household-label { font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.07em; color: #9ca3af; margin: 0 0 0.5rem; }
    .members-bar { display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 0.65rem; }
    .members-bar-label { font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.07em; color: #9ca3af; }
    .add-person-btn { padding: 0.28rem 0.7rem; border: 1px solid #d1d5db; border-radius: 5px;
      background: #fff; cursor: pointer; font-size: 12px; color: #374151; }
    .add-person-btn:hover { background: #eff6ff; border-color: #93c5fd; color: #2563eb; }
    .add-row-btn { padding: 0.25rem 0.65rem; border: 1px solid #d1d5db; border-radius: 5px;
      background: #fff; cursor: pointer; font-size: 12px; color: #374151; }
    .add-row-btn:hover { background: #f3f4f6; }
    .remove-btn { padding: 0.2rem 0.5rem; border: 1px solid #e5e7eb; border-radius: 4px;
      background: #fff; cursor: pointer; font-size: 11px; color: #9ca3af; }
    .remove-btn:hover { border-color: #fca5a5; color: #dc2626; background: #fff1f2; }
    .row-empty-note { font-size: 0.78rem; color: #9ca3af; font-style: italic; margin: 0.25rem 0 0; }
    .caregiver-section { border: 1px solid #fde68a; border-radius: 8px; background: #fffbeb;
      margin-bottom: 1.25rem; }
    .caregiver-header { display: flex; justify-content: space-between; align-items: center;
      padding: 0.6rem 0.85rem; border-bottom: 1px solid #fde68a; }
    .caregiver-section-label { font-size: 0.8rem; font-weight: 700; color: #92400e; }
    .caregiver-row-section { border: 1px solid #fde68a; border-radius: 6px; margin-bottom: 0.4rem; }
    .caregiver-row-header { display: flex; justify-content: space-between; align-items: center;
      padding: 0.3rem 0.6rem; background: #fef9c3; border-radius: 6px 6px 0 0;
      border-bottom: 1px solid #fde68a; }
    .caregiver-row-label { font-size: 0.72rem; font-weight: 600; color: #92400e; }
    .caregiver-rows { padding: 0 0.75rem; }
    .caregiver-note { font-size: 0.78rem; color: #92400e; padding: 0.35rem 0.85rem 0; }
    .no-rel-btn { padding: 0.25rem 0.6rem; font-size: 0.78rem; border-radius: 4px; cursor: pointer;
      border: 1px solid #d97706; background: #fff; color: #92400e; }
    .no-rel-btn.active { background: #d97706; color: #fff; border-color: #d97706; }
  </style>
</head>
<body>
<div class="demo-wrap">
  <h1>Eligibility walkthrough</h1>
  <p class="lede">
    Fill in fields and watch the determination converge. Each API call returns exactly which
    inputs are missing — resolved fields turn green, new ones may appear as others are filled.
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
  var SUBCOLL_KEYS  = ['income', 'expenses', 'jobs', 'assets']
  var SUBCOLL_LABELS = { income: 'Income', expenses: 'Expenses', jobs: 'Jobs', assets: 'Assets' }
  var FIELD_DESCS = ${JSON.stringify(fieldDescMap)}
  var SKIP_LOCS = {}

  // ---- state ----------------------------------------------------------------
  var program           = 'snap'
  var numMembers        = 1
  var memberIds         = ['person-1']
  var memberVals        = [{}]
  var collCounts        = [{ income: 0, expenses: 0, jobs: 0, assets: 0 }]
  var collVals          = [{ income: [], expenses: [], jobs: [], assets: [] }]
  var householdVals     = {}
  var caregiverRelCount = 0
  var caregiverRelVals  = []
  var noCaregiverRels   = false
  var noSubcoll         = [{ income: false, expenses: false, jobs: false, assets: false }]
  var fieldCache        = {}
  var allSeen           = []
  var curMissing        = new Set()
  var curStatus         = null
  var curDet            = null
  var debounce          = null
  var inflight          = false
  var memberSeq         = 1

  // ---- helpers --------------------------------------------------------------
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  }
  function coerce(raw, type) {
    if (type === 'Boolean') return raw === 'true'
    if (type === 'Int' || type === 'Dollar' || type === 'Percent') {
      var n = parseFloat(raw); return isNaN(n) ? undefined : n
    }
    return raw
  }
  function scopeOf(cpath) {
    var meta = fieldCache[cpath]; if (!meta) return null
    var loc = meta.location
    if (loc === 'household') return 'household'
    if (loc === 'members[]') return 'member'
    if (loc === 'caregiverRelationships[]') return 'caregiverRel'
    for (var i = 0; i < SUBCOLL_KEYS.length; i++) {
      if (loc === 'members[].' + SUBCOLL_KEYS[i] + '[]') return SUBCOLL_KEYS[i]
    }
    return null
  }
  function cpathFor(scope, field) {
    if (scope === 'household')    return 'household.' + field
    if (scope === 'member')       return 'members[].' + field
    if (scope === 'caregiverRel') return 'caregiverRelationships[].' + field
    return 'members[].' + scope + '[].' + field
  }
  function getVal(scope, mi, ri, field) {
    if (scope === 'household')    return householdVals[field]
    if (scope === 'member')       return memberVals[mi] && memberVals[mi][field]
    if (scope === 'caregiverRel') { var crv = caregiverRelVals[ri]; return crv ? crv[field] : undefined }
    var cv = collVals[mi] && collVals[mi][scope] && collVals[mi][scope][ri]
    return cv ? cv[field] : undefined
  }

  // ---- request builder ------------------------------------------------------
  function buildRequest() {
    var req = { members: [] }
    var hk = Object.keys(householdVals)
    if (hk.length > 0) {
      req.household = {}; hk.forEach(function(k) { req.household[k] = householdVals[k] })
    }
    if (caregiverRelCount > 0 || noCaregiverRels) {
      req.caregiverRelationships = []
      for (var j = 0; j < caregiverRelCount; j++) {
        var relRow = caregiverRelVals[j] || {}
        var rr = {}; Object.keys(relRow).forEach(function(k) { rr[k] = relRow[k] })
        if (Object.keys(rr).length > 0) req.caregiverRelationships.push(rr)
      }
    }
    for (var i = 0; i < numMembers; i++) {
      var mReq = { id: memberIds[i] }
      Object.keys(memberVals[i] || {}).forEach(function(k) { mReq[k] = memberVals[i][k] })
      for (var ci = 0; ci < SUBCOLL_KEYS.length; ci++) {
        var key = SUBCOLL_KEYS[ci]
        var cnt = (collCounts[i] && collCounts[i][key]) || 0
        if (noSubcoll[i] && noSubcoll[i][key]) {
          mReq[key] = []
        } else if (cnt > 0) {
          var filledRows = []
          for (var jj = 0; jj < cnt; jj++) {
            var row = (collVals[i] && collVals[i][key] && collVals[i][key][jj]) || {}
            var r = {}; Object.keys(row).forEach(function(k) { r[k] = row[k] })
            if (Object.keys(r).length > 0) filledRows.push(r)
          }
          if (filledRows.length > 0) mReq[key] = filledRows
        }
      }
      req.members.push(mReq)
    }
    return req
  }

  // ---- API call -------------------------------------------------------------
  function callApi() {
    saveState()
    var base = document.getElementById('base-url').value.replace(/\\/$/, '')
    var tok  = document.getElementById('api-token').value.trim()
    if (tok) {
      for (var i = 0; i < tok.length; i++) {
        if (tok.charCodeAt(i) > 255) { showError('Token contains non-ASCII characters.'); return }
      }
    }
    inflight = true; renderStatus()
    var headers = { 'Content-Type': 'application/json' }
    if (tok) headers['Authorization'] = 'Bearer ' + tok
    fetch(base + ENDPOINTS[program], { method: 'POST', headers: headers, body: JSON.stringify(buildRequest()) })
      .then(function(r) { return r.text() })
      .then(function(text) {
        var data; try { data = JSON.parse(text) } catch(e) { data = { _raw: text } }
        document.getElementById('raw-resp').textContent = JSON.stringify(data, null, 2)
        var det = (data.determinations && data.determinations[0]) ? data.determinations[0] : data
        curDet = det; curStatus = det.status || null
        var missing = det.missingInputs || data.missingInputs || []
        var newSet = new Set(), prevCount = allSeen.length
        missing.forEach(function(m) {
          newSet.add(m.requestPath)
          if (!fieldCache[m.requestPath]) {
            allSeen.push(m.requestPath)
            fieldCache[m.requestPath] = { field: m.field, label: m.label, location: m.location, type: m.type, options: m.options || [] }
          }
        })
        curMissing = newSet; inflight = false
        if (allSeen.length > prevCount) renderNewCards()
        else updateStates()
        renderStatus()
      })
      .catch(function(e) { inflight = false; showError(e.message) })
  }

  function showError(msg) {
    curStatus = 'error'; inflight = false
    var badge = document.getElementById('status-badge')
    badge.className = 'status-badge s-error'; badge.textContent = msg
    document.getElementById('progress-line').textContent = ''
  }

  // ---- value setters --------------------------------------------------------
  function setVal(scope, mi, ri, field, rawVal) {
    var cp = cpathFor(scope, field), meta = fieldCache[cp]
    var coerced = (rawVal === '__clear__' || rawVal === '' || rawVal === undefined)
      ? undefined : meta ? coerce(rawVal, meta.type) : rawVal
    if (scope === 'household') {
      if (coerced === undefined) delete householdVals[field]; else householdVals[field] = coerced
    } else if (scope === 'member') {
      memberVals[mi] = memberVals[mi] || {}
      if (coerced === undefined) delete memberVals[mi][field]; else memberVals[mi][field] = coerced
    } else if (scope === 'caregiverRel') {
      caregiverRelVals[ri] = caregiverRelVals[ri] || {}
      if (coerced === undefined) delete caregiverRelVals[ri][field]; else caregiverRelVals[ri][field] = coerced
    } else {
      collVals[mi] = collVals[mi] || {}
      collVals[mi][scope] = collVals[mi][scope] || []
      collVals[mi][scope][ri] = collVals[mi][scope][ri] || {}
      if (coerced === undefined) delete collVals[mi][scope][ri][field]; else collVals[mi][scope][ri][field] = coerced
    }
    document.querySelectorAll('button.bool-btn[data-scope="' + scope + '"][data-member="' + mi + '"][data-row="' + ri + '"][data-field="' + field + '"]').forEach(function(b) {
      b.classList.toggle('active', (b.dataset.bval === 'true' && coerced === true) || (b.dataset.bval === 'false' && coerced === false))
    })
    clearTimeout(debounce); debounce = setTimeout(callApi, 500)
  }

  // ---- program switch -------------------------------------------------------
  function setProgram(prog) {
    program = prog; numMembers = 1; memberSeq = 1
    memberIds = ['person-1']; memberVals = [{}]
    collCounts = [{ income: 0, expenses: 0, jobs: 0, assets: 0 }]
    collVals   = [{ income: [], expenses: [], jobs: [], assets: [] }]
    householdVals = {}; caregiverRelCount = 0; caregiverRelVals = []; noCaregiverRels = false
    noSubcoll = [{ income: false, expenses: false, jobs: false, assets: false }]
    fieldCache = {}; allSeen = []; curMissing = new Set()
    curStatus = null; curDet = null
    document.querySelectorAll('.prog-tab').forEach(function(b) { b.classList.toggle('active', b.dataset.prog === prog) })
    fullRender(); callApi()
  }

  // ---- field state ----------------------------------------------------------
  function fieldStateFor(cpath, scope, mi, ri) {
    if (!fieldCache[cpath]) return 'needed'
    var inM = curMissing.has(cpath)
    var hasV = getVal(scope, mi, ri, fieldCache[cpath].field) !== undefined
    if (inM && !hasV)  return 'needed'
    if (inM &&  hasV)  return 'still-needed'
    if (!inM && hasV)  return 'resolved'
    return 'auto-resolved'
  }
  function badgeText(s) {
    return s === 'needed'      ? 'missing'
      : s === 'still-needed'  ? 'still missing'
      : s === 'resolved'      ? '\\u2713 provided'
      : s === 'auto-resolved' ? 'not needed' : ''
  }

  // ---- input HTML -----------------------------------------------------------
  function dA(scope, mi, ri, field) {
    return 'data-scope="' + scope + '" data-member="' + mi + '" data-row="' + ri + '" data-field="' + esc(field) + '"'
  }
  function buildInputHTML(scope, mi, ri, cpath) {
    var meta = fieldCache[cpath]; if (!meta) return ''
    var field = meta.field, type = meta.type, opts = meta.options, val = getVal(scope, mi, ri, field)
    var da = dA(scope, mi, ri, field)
    if (type === 'Boolean') {
      var t = val === true, f = val === false
      return '<div class="bool-btns">' +
        '<button class="bool-btn' + (t ? ' active' : '') + '" ' + da + ' data-bval="true">Yes</button>' +
        '<button class="bool-btn' + (f ? ' active' : '') + '" ' + da + ' data-bval="false">No</button>' +
        (val !== undefined ? '<button class="bool-btn clr" ' + da + ' data-bval="__clear__">&#x2715;</button>' : '') +
        '</div>'
    }
    if (type === 'Enum' && opts && opts.length) {
      var o = '<option value="">-- select --</option>'
      opts.forEach(function(x) { o += '<option value="' + esc(x) + '"' + (val === x ? ' selected' : '') + '>' + esc(x) + '</option>' })
      return '<select ' + da + '>' + o + '</select>'
    }
    if (type === 'Date' || type === 'Day') return '<input type="date" ' + da + ' value="' + esc(val || '') + '" />'
    if (type === 'Int' || type === 'Dollar' || type === 'Percent') {
      var pre = type === 'Dollar' ? '<span class="num-affix pre">$</span>' : ''
      var suf = type === 'Percent' ? '<span class="num-affix suf">%</span>' : ''
      var step = type === 'Dollar' ? '0.01' : '1'
      return '<div class="num-wrap">' + pre + '<input type="number" min="0" step="' + step + '" ' + da + ' value="' + esc(val !== undefined ? val : '') + '" />' + suf + '</div>'
    }
    if (type === 'CollectionItem') {
      var o2 = '<option value="">-- select member --</option>'
      memberIds.forEach(function(id) { o2 += '<option value="' + esc(id) + '"' + (val === id ? ' selected' : '') + '>' + esc(id) + '</option>' })
      return '<select ' + da + '>' + o2 + '</select>'
    }
    return '<input type="text" ' + da + ' value="' + esc(val || '') + '" />'
  }

  // ---- card HTML ------------------------------------------------------------
  function buildCardHTML(cpath, scope, mi, ri) {
    var meta = fieldCache[cpath]; if (!meta) return ''
    var state = fieldStateFor(cpath, scope, mi, ri)
    var hint = meta.type
    if (meta.options && meta.options.length) hint += ': ' + meta.options.join(', ')
    var desc = FIELD_DESCS[cpath] || ''
    var defHtml = desc
      ? '<details class="field-def"><summary> what is this?</summary><div class="def-body">' + esc(desc) + '</div></details>'
      : ''
    return '<div class="field-card field-card-' + state + '" data-cpath="' + esc(cpath) + '" data-scope="' + scope + '" data-member="' + mi + '" data-row="' + ri + '">' +
      '<div class="field-card-header">' +
        '<span class="field-label" title="' + esc(hint) + '">' + esc(meta.label || cpath) + '</span>' +
        '<span class="field-badge b-' + state + '">' + badgeText(state) + '</span>' +
      '</div>' +
      '<div class="field-path">' + esc(cpath) + '</div>' +
      defHtml +
      '<div class="field-input">' + buildInputHTML(scope, mi, ri, cpath) + '</div>' +
    '</div>'
  }

  // ---- section builders -----------------------------------------------------
  function cardsForLoc(loc, scope, mi, ri) {
    var html = ''
    allSeen.forEach(function(cp) {
      var m = fieldCache[cp]
      if (m && m.location === loc && !SKIP_LOCS[m.location]) html += buildCardHTML(cp, scope, mi, ri)
    })
    return html
  }
  function rowSectionHTML(mi, collKey, ri) {
    var lbl = SUBCOLL_LABELS[collKey], loc = 'members[].' + collKey + '[]'
    var cardsHTML = cardsForLoc(loc, collKey, mi, ri)
    return '<div class="row-section" id="row-' + mi + '-' + collKey + '-' + ri + '">' +
      '<div class="row-header">' +
        '<span class="row-header-label">' + esc(lbl) + ' row ' + (ri + 1) + '</span>' +
        '<button class="remove-btn" data-remove-coll="' + collKey + '" data-member="' + mi + '" data-row="' + ri + '">&#x2715;</button>' +
      '</div>' +
      '<div class="row-fields"><div class="field-cards" id="row-' + mi + '-' + collKey + '-' + ri + '-cards">' + cardsHTML + '</div></div>' +
    '</div>'
  }
  function subCollHTML(mi) {
    var html = ''
    for (var ci = 0; ci < SUBCOLL_KEYS.length; ci++) {
      var key = SUBCOLL_KEYS[ci], lbl = SUBCOLL_LABELS[key]
      var cnt = (collCounts[mi] && collCounts[mi][key]) || 0
      var isNo = (noSubcoll[mi] && noSubcoll[mi][key]) || false
      html += '<div class="subcoll-section" id="member-' + mi + '-' + key + '-section">' +
        '<div class="subcoll-header">' +
          '<span class="subcoll-label">' + esc(lbl) + '</span>' +
          '<span id="member-' + mi + '-' + key + '-hint" class="subcoll-needed-hint"></span>' +
          '<span style="display:flex;gap:0.4rem;align-items:center">' +
            '<button class="no-rel-btn' + (isNo ? ' active' : '') + '" data-no-subcoll="' + key + '" data-member="' + mi + '">' + (isNo ? '✓ No ' : 'No ') + esc(lbl.toLowerCase()) + '</button>' +
            '<button class="add-row-btn" data-add-coll="' + key + '" data-member="' + mi + '">+ Add ' + esc(lbl.toLowerCase()) + ' row</button>' +
          '</span>' +
        '</div>' +
        '<div id="member-' + mi + '-' + key + '-rows">'
      for (var j = 0; j < cnt; j++) html += rowSectionHTML(mi, key, j)
      html += '</div></div>'
    }
    return html
  }
  function memberSectionHTML(mi) {
    var lbl = 'Person ' + (mi + 1)
    var cardsHTML = cardsForLoc('members[]', 'member', mi, 0)
    return '<div class="member-section" id="member-section-' + mi + '">' +
      '<div class="member-header">' +
        '<span class="member-count-label">' + esc(lbl) + '</span>' +
        (numMembers > 1 ? '<button class="remove-btn" data-remove-member="' + mi + '">Remove</button>' : '') +
      '</div>' +
      '<div class="member-fields"><div class="field-cards" id="member-' + mi + '-cards">' + cardsHTML + '</div></div>' +
      subCollHTML(mi) +
    '</div>'
  }

  function caregiverRelRowHTML(ri) {
    var cardsHTML = cardsForLoc('caregiverRelationships[]', 'caregiverRel', 0, ri)
    return '<div class="caregiver-row-section" id="caregiver-row-' + ri + '">' +
      '<div class="caregiver-row-header">' +
        '<span class="caregiver-row-label">Relationship ' + (ri + 1) + '</span>' +
        '<button class="remove-btn" data-remove-rel="' + ri + '">&#x2715;</button>' +
      '</div>' +
      '<div class="row-fields"><div class="field-cards" id="caregiver-row-' + ri + '-cards">' + cardsHTML + '</div></div>' +
    '</div>'
  }
  function caregiverRelSectionHTML() {
    var html = '<div class="caregiver-section" id="caregiver-section">' +
      '<div class="caregiver-header">' +
        '<span class="caregiver-section-label">Caregiver relationships</span>' +
        '<span style="display:flex;gap:0.4rem;align-items:center">' +
          '<button class="no-rel-btn' + (noCaregiverRels ? ' active' : '') + '" id="no-rel-btn">' + (noCaregiverRels ? '✓ No relationships' : 'No relationships') + '</button>' +
          '<button class="add-row-btn" id="add-rel-btn">+ Add relationship</button>' +
        '</span>' +
      '</div>' +
      '<p class="caregiver-note">Affects work requirement exemptions. Add a relationship if applicable, or click “No relationships” to answer that there are none.</p>' +
      '<div class="caregiver-rows" id="caregiver-rows">'
    for (var j = 0; j < caregiverRelCount; j++) html += caregiverRelRowHTML(j)
    html += '</div></div>'
    return html
  }

  // ---- full render ----------------------------------------------------------
  function fullRender() {
    var fc2 = document.getElementById('fields-container'), html = ''
    var hCards = cardsForLoc('household', 'household', 0, 0)
    if (hCards) html += '<div class="household-section"><h3 class="household-label">Household</h3><div class="field-cards" id="household-cards">' + hCards + '</div></div>'
    html += '<div class="members-bar"><span class="members-bar-label">Members</span><button class="add-person-btn" id="add-person-btn">+ Add person</button></div>'
    for (var i = 0; i < numMembers; i++) html += memberSectionHTML(i)
    var hasCaregiverFields = allSeen.some(function(cp) { var m = fieldCache[cp]; return m && m.location === 'caregiverRelationships[]' })
    if (hasCaregiverFields || caregiverRelCount > 0) html += caregiverRelSectionHTML()
    if (!hCards && !allSeen.length) html = '<p class="fields-hint">Loading...</p>' + html
    fc2.innerHTML = html
  }

  // ---- render new cards (incremental, preserves inputs) ---------------------
  function renderNewCards() {
    var hint = document.querySelector('#fields-container .fields-hint')
    if (hint) hint.remove()
    allSeen.forEach(function(cp) {
      var meta = fieldCache[cp]; if (!meta || SKIP_LOCS[meta.location]) return
      var scope = scopeOf(cp); if (!scope) return

      if (scope === 'household') {
        var found = false
        document.querySelectorAll('.field-card[data-scope="household"]').forEach(function(el) { if (el.dataset.cpath === cp) found = true })
        if (found) return
        var cardsEl = document.getElementById('household-cards')
        if (!cardsEl) {
          var fc3 = document.getElementById('fields-container')
          var hsec = document.createElement('div')
          hsec.className = 'household-section'
          hsec.innerHTML = '<h3 class="household-label">Household</h3><div class="field-cards" id="household-cards"></div>'
          fc3.insertBefore(hsec, fc3.querySelector('.members-bar') || fc3.firstChild)
          cardsEl = document.getElementById('household-cards')
        }
        if (cardsEl) cardsEl.insertAdjacentHTML('beforeend', buildCardHTML(cp, 'household', 0, 0))

      } else if (scope === 'member') {
        for (var i = 0; i < numMembers; i++) {
          var f2 = false
          document.querySelectorAll('.field-card[data-scope="member"][data-member="' + i + '"]').forEach(function(el) { if (el.dataset.cpath === cp) f2 = true })
          if (!f2) {
            var ce = document.getElementById('member-' + i + '-cards')
            if (ce) ce.insertAdjacentHTML('beforeend', buildCardHTML(cp, 'member', i, 0))
          }
        }

      } else if (scope === 'caregiverRel') {
        if (!document.getElementById('caregiver-section')) {
          var fc2b = document.getElementById('fields-container')
          var csec = document.createElement('div')
          csec.innerHTML = caregiverRelSectionHTML()
          fc2b.appendChild(csec.firstChild)
        }
        for (var cri = 0; cri < caregiverRelCount; cri++) {
          var fc4 = false
          document.querySelectorAll('.field-card[data-scope="caregiverRel"][data-row="' + cri + '"]').forEach(function(el) { if (el.dataset.cpath === cp) fc4 = true })
          if (!fc4) {
            var rce2 = document.getElementById('caregiver-row-' + cri + '-cards')
            if (rce2) rce2.insertAdjacentHTML('beforeend', buildCardHTML(cp, 'caregiverRel', 0, cri))
          }
        }
      } else {
        var collKey = scope
        for (var mi2 = 0; mi2 < numMembers; mi2++) {
          var cnt2 = (collCounts[mi2] && collCounts[mi2][collKey]) || 0
          for (var ri2 = 0; ri2 < cnt2; ri2++) {
            var f3 = false
            document.querySelectorAll('.field-card[data-scope="' + collKey + '"][data-member="' + mi2 + '"][data-row="' + ri2 + '"]').forEach(function(el) { if (el.dataset.cpath === cp) f3 = true })
            if (!f3) {
              var rce3 = document.getElementById('row-' + mi2 + '-' + collKey + '-' + ri2 + '-cards')
              if (rce3) rce3.insertAdjacentHTML('beforeend', buildCardHTML(cp, collKey, mi2, ri2))
            }
          }
        }
      }
    })
    markEmptyRows()
    updateStates()
  }

  function markEmptyRows() {
    document.querySelectorAll('.row-section, .caregiver-row-section').forEach(function(rowSec) {
      var rce = rowSec.querySelector('.field-cards')
      if (rce && !rce.children.length && !rowSec.querySelector('.row-empty-note')) {
        rce.insertAdjacentHTML('afterend', '<p class="row-empty-note">No fields required for this row in the current program.</p>')
      }
    })
  }

  // ---- update states (CSS only, no DOM rebuild) -----------------------------
  function updateStates() {
    document.querySelectorAll('.field-card[data-cpath]').forEach(function(card) {
      var cpath = card.dataset.cpath, scope = card.dataset.scope
      var mi = parseInt(card.dataset.member || '0'), ri = parseInt(card.dataset.row || '0')
      var state = fieldStateFor(cpath, scope, mi, ri)
      card.className = 'field-card field-card-' + state
      var badge = card.querySelector('.field-badge')
      if (badge) { badge.className = 'field-badge b-' + state; badge.textContent = badgeText(state) }
    })
    updateSubcollHints()
  }
  function updateSubcollHints() {
    for (var mi = 0; mi < numMembers; mi++) {
      for (var ci = 0; ci < SUBCOLL_KEYS.length; ci++) {
        var key = SUBCOLL_KEYS[ci]
        var hint = document.getElementById('member-' + mi + '-' + key + '-hint')
        if (!hint) continue
        var cnt = (collCounts[mi] && collCounts[mi][key]) || 0
        if (cnt > 0 || (noSubcoll[mi] && noSubcoll[mi][key])) { hint.textContent = ''; continue }
        var loc = 'members[].' + key + '[]'
        var needed = 0
        allSeen.forEach(function(cp) {
          var m = fieldCache[cp]
          if (m && m.location === loc && curMissing.has(cp)) needed++
        })
        hint.textContent = needed > 0 ? needed + ' field' + (needed === 1 ? '' : 's') + ' missing — add a row' : ''
      }
    }
  }

  // ---- status row -----------------------------------------------------------
  function renderStatus() {
    var badge = document.getElementById('status-badge'), prog = document.getElementById('progress-line')
    if (inflight) { badge.className = 'status-badge s-loading'; badge.textContent = 'Loading...'; prog.textContent = ''; return }
    var s = curStatus || 'null'
    var hasMissing = curMissing && curMissing.size > 0
    var isPartial = hasMissing && (s === 'denied' || s === 'ineligible')
    badge.className = 'status-badge s-' + (isPartial ? s + '-partial' : s)
    if (s === 'approved') {
      badge.textContent = 'Approved' + (curDet && curDet.benefitAmount ? ' -- $' + curDet.benefitAmount + '/mo' : '')
    } else if (s === 'denied' || s === 'ineligible') {
      var label = (s === 'denied' ? 'Denied' : 'Ineligible') + (curDet && curDet.denialReasonCode ? ': ' + curDet.denialReasonCode.replace(/_/g, ' ') : '')
      badge.textContent = isPartial ? label + ' (partial)' : label
    } else if (s === 'pending') { badge.textContent = 'Pending'
    } else if (s === 'null')    { badge.textContent = '--'
    } else                      { badge.textContent = s }
    var provided = 0, autoRes = 0
    document.querySelectorAll('.field-card[data-cpath]').forEach(function(card) {
      var st = fieldStateFor(card.dataset.cpath, card.dataset.scope, parseInt(card.dataset.member||'0'), parseInt(card.dataset.row||'0'))
      if (st === 'resolved') provided++
      else if (st === 'auto-resolved') autoRes++
    })
    var parts = []
    if (provided > 0) parts.push('<span class="prog-res">\\u2713 ' + provided + ' provided</span>')
    if (autoRes > 0)  parts.push('<span style="color:#9ca3af">' + autoRes + ' not needed</span>')
    if (curMissing.size > 0) parts.push('<span class="prog-need">' + curMissing.size + ' missing</span>')
    prog.innerHTML = parts.length ? parts.join(' &nbsp;&middot;&nbsp; ') : ''
  }

  // ---- member / row management ----------------------------------------------
  function addMember() {
    memberSeq++
    var newIdx = numMembers; numMembers++
    memberIds.push('person-' + memberSeq); memberVals.push({})
    collCounts.push({ income: 0, expenses: 0, jobs: 0, assets: 0 })
    collVals.push({ income: [], expenses: [], jobs: [], assets: [] })
    noSubcoll.push({ income: false, expenses: false, jobs: false, assets: false })
    var prevSec = document.getElementById('member-section-' + (newIdx - 1))
    var div = document.createElement('div')
    div.innerHTML = memberSectionHTML(newIdx)
    var newSec = div.firstChild
    if (prevSec && prevSec.nextSibling) prevSec.parentNode.insertBefore(newSec, prevSec.nextSibling)
    else if (prevSec) prevSec.parentNode.appendChild(newSec)
    else document.getElementById('fields-container').appendChild(newSec)
    refreshRemoveBtns()
  }
  function removeMember(mi) {
    memberIds.splice(mi, 1); memberVals.splice(mi, 1)
    collCounts.splice(mi, 1); collVals.splice(mi, 1); noSubcoll.splice(mi, 1); numMembers--
    fullRender(); callApi()
  }
  function refreshRemoveBtns() {
    for (var i = 0; i < numMembers; i++) {
      var hdr = document.querySelector('#member-section-' + i + ' .member-header')
      if (!hdr) continue
      var ex = hdr.querySelector('.remove-btn')
      if (numMembers > 1 && !ex) {
        var btn = document.createElement('button')
        btn.className = 'remove-btn'; btn.dataset.removeMember = i; btn.textContent = 'Remove'
        hdr.appendChild(btn)
      } else if (numMembers === 1 && ex) { ex.remove() }
    }
  }
  function addRow(mi, collKey) {
    if (noSubcoll[mi] && noSubcoll[mi][collKey]) {
      noSubcoll[mi][collKey] = false
      var noBtn = document.querySelector('[data-no-subcoll="' + collKey + '"][data-member="' + mi + '"]')
      if (noBtn) { noBtn.classList.remove('active'); noBtn.textContent = 'No ' + SUBCOLL_LABELS[collKey].toLowerCase() }
    }
    collCounts[mi] = collCounts[mi] || {}
    var ri = collCounts[mi][collKey] || 0; collCounts[mi][collKey] = ri + 1
    collVals[mi] = collVals[mi] || {}
    collVals[mi][collKey] = collVals[mi][collKey] || []; collVals[mi][collKey][ri] = {}
    var rowsEl = document.getElementById('member-' + mi + '-' + collKey + '-rows')
    if (rowsEl) {
      var div = document.createElement('div')
      div.innerHTML = rowSectionHTML(mi, collKey, ri); rowsEl.appendChild(div.firstChild)
    }
    callApi()
  }
  function removeRow(mi, collKey, ri) {
    collCounts[mi][collKey] = Math.max(0, (collCounts[mi][collKey] || 1) - 1)
    if (collVals[mi] && collVals[mi][collKey]) collVals[mi][collKey].splice(ri, 1)
    fullRender(); callApi()
  }
  function addCaregiverRel() {
    noCaregiverRels = false
    var ri = caregiverRelCount; caregiverRelCount++; caregiverRelVals[ri] = {}
    if (!document.getElementById('caregiver-section')) { fullRender(); return }
    var noBtn = document.getElementById('no-rel-btn')
    if (noBtn) { noBtn.classList.remove('active'); noBtn.textContent = 'No relationships' }
    var rowsEl = document.getElementById('caregiver-rows')
    if (rowsEl) {
      var div = document.createElement('div')
      div.innerHTML = caregiverRelRowHTML(ri); rowsEl.appendChild(div.firstChild)
    }
    callApi()
  }
  function toggleNoCaregiverRels() {
    noCaregiverRels = !noCaregiverRels
    var noBtn = document.getElementById('no-rel-btn')
    if (noBtn) { noBtn.classList.toggle('active', noCaregiverRels); noBtn.textContent = noCaregiverRels ? '✓ No relationships' : 'No relationships' }
    callApi()
  }
  function toggleNoSubcoll(mi, key) {
    noSubcoll[mi] = noSubcoll[mi] || {}
    noSubcoll[mi][key] = !noSubcoll[mi][key]
    var isNo = noSubcoll[mi][key]
    var noBtn = document.querySelector('[data-no-subcoll="' + key + '"][data-member="' + mi + '"]')
    if (noBtn) { noBtn.classList.toggle('active', isNo); noBtn.textContent = isNo ? '✓ No ' + SUBCOLL_LABELS[key].toLowerCase() : 'No ' + SUBCOLL_LABELS[key].toLowerCase() }
    callApi()
  }
  function removeCaregiverRel(ri) {
    caregiverRelVals.splice(ri, 1); caregiverRelCount = Math.max(0, caregiverRelCount - 1)
    fullRender(); callApi()
  }

  // ---- event delegation -----------------------------------------------------
  var fc = document.getElementById('fields-container')
  fc.addEventListener('change', function(e) {
    var scope = e.target.dataset && e.target.dataset.scope
    var field = e.target.dataset && e.target.dataset.field
    if (!scope || !field) return
    setVal(scope, parseInt(e.target.dataset.member||'0'), parseInt(e.target.dataset.row||'0'), field, e.target.value)
  })
  fc.addEventListener('input', function(e) {
    var scope = e.target.dataset && e.target.dataset.scope
    var field = e.target.dataset && e.target.dataset.field
    if (!scope || !field || e.target.type !== 'number') return
    clearTimeout(debounce)
    var cap = { scope: scope, mi: parseInt(e.target.dataset.member||'0'), ri: parseInt(e.target.dataset.row||'0'), field: field, val: e.target.value }
    debounce = setTimeout(function() { setVal(cap.scope, cap.mi, cap.ri, cap.field, cap.val) }, 500)
  })
  fc.addEventListener('click', function(e) {
    var btn = e.target.closest && e.target.closest('button'); if (!btn) return
    if (btn.dataset.bval !== undefined) {
      var scope = btn.dataset.scope, field = btn.dataset.field
      if (scope && field) {
        var alreadyActive = btn.classList.contains('active')
        var bval = (alreadyActive && btn.dataset.bval !== '__clear__') ? '__clear__' : btn.dataset.bval
        setVal(scope, parseInt(btn.dataset.member||'0'), parseInt(btn.dataset.row||'0'), field, bval)
      }
      return
    }
    if (btn.dataset.addColl) { addRow(parseInt(btn.dataset.member||'0'), btn.dataset.addColl); return }
    if (btn.dataset.removeColl) { removeRow(parseInt(btn.dataset.member||'0'), btn.dataset.removeColl, parseInt(btn.dataset.row||'0')); return }
    if (btn.dataset.removeMember !== undefined) { removeMember(parseInt(btn.dataset.removeMember)); return }
    if (btn.id === 'add-person-btn') { addMember(); return }
    if (btn.id === 'add-rel-btn') { addCaregiverRel(); return }
    if (btn.id === 'no-rel-btn') { toggleNoCaregiverRels(); return }
    if (btn.dataset.removeRel !== undefined) { removeCaregiverRel(parseInt(btn.dataset.removeRel)); return }
    if (btn.dataset.noSubcoll) { toggleNoSubcoll(parseInt(btn.dataset.member||'0'), btn.dataset.noSubcoll); return }
  })

  document.querySelector('.prog-tabs').addEventListener('click', function(e) {
    var btn = e.target.closest('.prog-tab'); if (!btn) return; setProgram(btn.dataset.prog)
  })
  document.getElementById('reset-btn').addEventListener('click', function() {
    try { localStorage.removeItem('demo-state') } catch(e) {}
    setProgram(program)
  })

  var tokIn = document.getElementById('api-token')
  var saved = localStorage.getItem('demo-bearer-token')
  if (saved) tokIn.value = saved
  tokIn.addEventListener('input', function() {
    var v = tokIn.value.trim()
    if (v) localStorage.setItem('demo-bearer-token', v)
    else   localStorage.removeItem('demo-bearer-token')
  })

  // ---- state persistence ----------------------------------------------------
  function saveState() {
    try {
      localStorage.setItem('demo-state', JSON.stringify({
        program: program, numMembers: numMembers, memberSeq: memberSeq,
        memberIds: memberIds, memberVals: memberVals,
        collCounts: collCounts, collVals: collVals, householdVals: householdVals,
        caregiverRelCount: caregiverRelCount, caregiverRelVals: caregiverRelVals,
        noCaregiverRels: noCaregiverRels, noSubcoll: noSubcoll
      }))
    } catch(e) {}
  }
  function loadState() {
    try {
      var raw = localStorage.getItem('demo-state'); if (!raw) return false
      var s = JSON.parse(raw); if (!s || typeof s !== 'object') return false
      program = s.program || 'snap'
      numMembers = s.numMembers || 1; memberSeq = s.memberSeq || 1
      memberIds = s.memberIds || ['person-1']; memberVals = s.memberVals || [{}]
      collCounts = s.collCounts || [{ income: 0, expenses: 0, jobs: 0, assets: 0 }]
      collVals   = s.collVals   || [{ income: [], expenses: [], jobs: [], assets: [] }]
      householdVals = s.householdVals || {}
      caregiverRelCount = s.caregiverRelCount || 0; caregiverRelVals = s.caregiverRelVals || []
      noCaregiverRels = !!s.noCaregiverRels
      noSubcoll = s.noSubcoll || Array.from({length: numMembers}, function() { return { income: false, expenses: false, jobs: false, assets: false } })
      document.querySelectorAll('.prog-tab').forEach(function(b) { b.classList.toggle('active', b.dataset.prog === program) })
      return true
    } catch(e) { return false }
  }

  // ---- init -----------------------------------------------------------------
  loadState()
  fullRender()
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
