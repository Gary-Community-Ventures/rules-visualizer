/**
 * Bench harness: head-to-head perf of Fact Graph execution engines.
 *
 * Spawns one subprocess per (engine × ruleset × count) cell, collects the
 * worker's JSON output, and prints a markdown table plus writes a CSV
 * for follow-up analysis.
 *
 * Engine variants:
 *   - vanilla-sjs:  Scala.js bundle with both monkey-patches disabled
 *                   (the engine as IRS Direct File ships it)
 *   - patched-sjs:  Scala.js bundle with the overrideDefault correctness
 *                   fix AND the Fact.get JS-side memoization
 *   - wasm:         factgraph-rs Rust→WASM
 *   - jvm           (future) Scala JVM build of IRS-Public/fact-graph
 *
 * Each worker runs in its own Node process so the patch toggle (which
 * reads its env var at module load) is honored cleanly and JIT state
 * doesn't leak between engines.
 *
 * Usage:
 *   npx tsx scripts/bench-engines/run.ts
 *   npx tsx scripts/bench-engines/run.ts --counts=1,10,100 --rulesets=snap-fy2026
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type Engine = 'vanilla-sjs' | 'patched-sjs' | 'wasm'

type Cell = {
  engine: Engine
  ruleset: string
  count: number
  warmup: number
  caseIndex: number
}

type WorkerResult = {
  engine: Engine
  ruleset: string
  count: number
  warmup: number
  coldMs: number
  totalMs: number
  meanMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  minMs: number
  maxMs: number
  throughputPerSec: number
  outputSample: Record<string, string>
}

const ENGINES: Engine[] = ['vanilla-sjs', 'patched-sjs', 'wasm']

function parseList(s: string | undefined): string[] | undefined {
  if (!s) return undefined
  return s.split(',').map((x) => x.trim()).filter(Boolean)
}

function parseArgs() {
  const args = new Map<string, string>()
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a)
    if (m) args.set(m[1], m[2])
  }
  return {
    counts: (parseList(args.get('counts')) ?? ['1', '100', '1000']).map(Number),
    rulesets: parseList(args.get('rulesets')) ?? ['snap-fy2026', 'snap-complete'],
    engines: (parseList(args.get('engines')) as Engine[] | undefined) ?? ENGINES,
    warmup: Number(args.get('warmup') ?? 5),
    caseIndex: args.get('case-index') ? Number(args.get('case-index')) : undefined,
  }
}

// Per-ruleset default case index. snap-complete index 10 is the 5-member
// household — that's where the patched-sjs Fact.get cache and the wasm
// engine's lack-of-bridge-cost both shine. Index 0 is a 1-member case
// and trivially fast on all engines.
const DEFAULT_CASE_INDEX: Record<string, number> = {
  'snap-complete': 10,
}

function runWorker(cell: Cell): Promise<WorkerResult> {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const workerPath = path.join(here, 'worker.ts')
  const env = { ...process.env }
  if (cell.engine === 'vanilla-sjs') env.FACTGRAPH_DISABLE_PATCHES = '1'
  else delete env.FACTGRAPH_DISABLE_PATCHES
  return new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      [
        'tsx',
        workerPath,
        `--engine=${cell.engine}`,
        `--ruleset=${cell.ruleset}`,
        `--count=${cell.count}`,
        `--warmup=${cell.warmup}`,
        `--case-index=${cell.caseIndex}`,
      ],
      { env, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => err.push(d))
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `worker exit ${code} for ${cell.engine}/${cell.ruleset}/${cell.count}\nstderr:\n${Buffer.concat(err).toString()}`
          )
        )
        return
      }
      try {
        const parsed = JSON.parse(Buffer.concat(out).toString()) as WorkerResult
        resolve(parsed)
      } catch (e) {
        reject(
          new Error(
            `worker output not JSON for ${cell.engine}/${cell.ruleset}/${cell.count}:\n${Buffer.concat(out).toString()}`
          )
        )
      }
    })
  })
}

function fmt(ms: number): string {
  if (ms < 1) return `${ms.toFixed(3)} ms`
  if (ms < 10) return `${ms.toFixed(2)} ms`
  if (ms < 1000) return `${ms.toFixed(1)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

function tableFor(
  results: WorkerResult[],
  ruleset: string,
  count: number
): string {
  const rows = results.filter((r) => r.ruleset === ruleset && r.count === count)
  rows.sort((a, b) => ENGINES.indexOf(a.engine) - ENGINES.indexOf(b.engine))
  const lines: string[] = []
  lines.push(`### ${ruleset} — ${count} ${count === 1 ? 'execute' : 'executes'}`)
  lines.push('')
  lines.push('| engine | cold | mean | vs. best | p50 | p95 | p99 | throughput |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
  // Find the fastest mean so we can show relative-speed multipliers.
  const fastestMean = Math.min(...rows.map((r) => r.meanMs))
  for (const r of rows) {
    const rel = r.meanMs === fastestMean ? '1.00×' : `${(r.meanMs / fastestMean).toFixed(2)}×`
    lines.push(
      `| ${r.engine} | ${fmt(r.coldMs)} | ${fmt(r.meanMs)} | ${rel} | ${fmt(r.p50Ms)} | ${fmt(r.p95Ms)} | ${fmt(r.p99Ms)} | ${r.throughputPerSec.toFixed(0)}/s |`
    )
  }
  return lines.join('\n')
}

async function main() {
  const opts = parseArgs()
  const cells: Cell[] = []
  for (const ruleset of opts.rulesets) {
    const caseIndex = opts.caseIndex ?? DEFAULT_CASE_INDEX[ruleset] ?? 0
    for (const count of opts.counts) {
      for (const engine of opts.engines) {
        cells.push({ engine, ruleset, count, warmup: opts.warmup, caseIndex })
      }
    }
  }

  process.stderr.write(`running ${cells.length} cells…\n`)
  const results: WorkerResult[] = []
  // Serial, not parallel — we want clean timings, not thrashed CPUs.
  for (const cell of cells) {
    process.stderr.write(
      `  ${cell.engine.padEnd(13)} ${cell.ruleset.padEnd(15)} count=${cell.count}…`
    )
    const t = performance.now()
    try {
      const r = await runWorker(cell)
      results.push(r)
      process.stderr.write(
        ` mean=${fmt(r.meanMs)}  (took ${fmt(performance.now() - t)})\n`
      )
    } catch (e) {
      process.stderr.write(` FAILED\n${(e as Error).message}\n`)
    }
  }

  // Markdown table per (ruleset, count)
  const md: string[] = []
  md.push(`# Engine bench — ${new Date().toISOString()}`)
  md.push('')
  for (const ruleset of opts.rulesets) {
    for (const count of opts.counts) {
      md.push(tableFor(results, ruleset, count))
      md.push('')
    }
  }

  const here = path.dirname(fileURLToPath(import.meta.url))
  const resultsDir = path.join(here, 'results')
  fs.mkdirSync(resultsDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const mdPath = path.join(resultsDir, `${ts}.md`)
  const csvPath = path.join(resultsDir, `${ts}.csv`)
  fs.writeFileSync(mdPath, md.join('\n'))

  const csvHeader =
    'engine,ruleset,count,warmup,coldMs,totalMs,meanMs,p50Ms,p95Ms,p99Ms,minMs,maxMs,throughputPerSec'
  const csvRows = results.map((r) =>
    [
      r.engine,
      r.ruleset,
      r.count,
      r.warmup,
      r.coldMs,
      r.totalMs,
      r.meanMs,
      r.p50Ms,
      r.p95Ms,
      r.p99Ms,
      r.minMs,
      r.maxMs,
      r.throughputPerSec,
    ].join(',')
  )
  fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n'))

  process.stdout.write(md.join('\n') + '\n')
  process.stderr.write(`\nresults: ${mdPath}\n         ${csvPath}\n`)
}

main().catch((e) => {
  process.stderr.write(`run error: ${(e as Error).stack ?? e}\n`)
  process.exit(1)
})
