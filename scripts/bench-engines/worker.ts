/**
 * Single-engine bench worker. Loads exactly one Fact Graph executor in this
 * process (so the Scala.js patch toggle is honored at module load), runs
 * `count` executes against a ruleset's first tests.json case, and prints a
 * JSON summary to stdout.
 *
 * Invoked by `run.ts` as a subprocess; not meant to be run by hand.
 *
 * Args:
 *   --engine=<vanilla-sjs|patched-sjs|wasm>   which executor to load
 *   --ruleset=<id>                            ruleset under data/factgraph/
 *   --count=<N>                               measured executes
 *   --warmup=<K>                              warmup executes (not counted)
 *   --case-index=<i>                          which tests.json case to use (default 0)
 *
 * The vanilla-sjs and patched-sjs engines both load executor.ts; the
 * FACTGRAPH_DISABLE_PATCHES env var (set by the orchestrator) decides
 * which mode is active. The wasm engine loads executor-rs.ts instead.
 */
// Silence the core package's "Loaded ruleset …" logs — they go to stdout
// and we reserve stdout for the worker's JSON result. Logs are routed to
// stderr so they still surface during debugging via the orchestrator.
console.log = (...args: unknown[]) => console.error(...args)

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  loadFactGraphData,
  getRawFacts,
  getRuleset,
  type RawFact,
} from 'rules-visualizer-factgraph-core'

// wasmTimings + resetWasmTimings come from the SAME module instance that
// the dynamic `loadExecutor` returns. Importing them from the package
// alias resolves to a different module identity under tsx (the package's
// index.ts re-export creates a fresh import-graph entry), so the
// counters increment over there but stay at zero over here. We re-read
// them from the dynamically-imported module to stay on the same
// instance.
type WasmTimings = {
  deserializeMs: number
  engineMs: number
  serializeMs: number
  count: number
}
let wasmTimings: WasmTimings = {
  deserializeMs: 0,
  engineMs: 0,
  serializeMs: 0,
  count: 0,
}
let resetWasmTimings: () => void = () => {}

type ExecuteFn = (
  rulesetId: string,
  facts: RawFact[],
  inputs: Record<string, unknown>,
  modelNodes: Record<string, { content: { dataType?: string } }>,
  entities?: Record<string, Record<string, unknown>[]>,
  readPaths?: Set<string>
) => Record<string, unknown>

type CaseFixture = {
  id: string
  inputs?: Record<string, unknown>
  entities?: Record<string, Record<string, unknown>[]>
  expect?: Record<string, unknown>
}

function parseArgs(): {
  engine: 'vanilla-sjs' | 'patched-sjs' | 'wasm'
  ruleset: string
  count: number
  warmup: number
  caseIndex: number
} {
  const args = new Map<string, string>()
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a)
    if (m) args.set(m[1], m[2])
  }
  const engine = args.get('engine') as 'vanilla-sjs' | 'patched-sjs' | 'wasm'
  if (!engine || !['vanilla-sjs', 'patched-sjs', 'wasm'].includes(engine)) {
    throw new Error(`bad --engine: ${args.get('engine')}`)
  }
  const ruleset = args.get('ruleset')
  if (!ruleset) throw new Error('missing --ruleset')
  return {
    engine,
    ruleset,
    count: Number(args.get('count') ?? 100),
    warmup: Number(args.get('warmup') ?? 5),
    caseIndex: Number(args.get('case-index') ?? 0),
  }
}

async function loadExecutor(
  engine: 'vanilla-sjs' | 'patched-sjs' | 'wasm'
): Promise<ExecuteFn> {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const corePath = path.resolve(here, '../../packages/factgraph-core/src')
  const file = engine === 'wasm' ? 'executor-rs.ts' : 'executor.ts'
  // vanilla-sjs and patched-sjs both load executor.ts; the env var
  // FACTGRAPH_DISABLE_PATCHES (set by the orchestrator before spawning
  // this process) is read at executor.ts module load and decides which
  // mode applies.
  const mod = await import(path.join(corePath, file))
  wasmTimings = mod.wasmTimings as WasmTimings
  resetWasmTimings = mod.resetWasmTimings as () => void
  return mod.executeFactGraph as ExecuteFn
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

async function main() {
  const opts = parseArgs()
  const here = path.dirname(fileURLToPath(import.meta.url))
  const dataDir = path.resolve(here, '../../data/factgraph')

  // Phase 1: cold-start cost (module load + ruleset parse). The executor
  // module's top-level code (which applies the Scala.js patches in
  // patched mode) runs during this import.
  const coldStart = performance.now()
  const executeFactGraph = await loadExecutor(opts.engine)
  loadFactGraphData(dataDir)
  const facts = getRawFacts(opts.ruleset)
  const model = getRuleset(opts.ruleset)
  if (!facts || !model) throw new Error(`ruleset not loaded: ${opts.ruleset}`)
  const coldMs = performance.now() - coldStart

  // Phase 2: load the test fixture inputs we'll feed each execute.
  const testsPath = path.join(dataDir, opts.ruleset, 'tests.json')
  const tests: CaseFixture[] = JSON.parse(fs.readFileSync(testsPath, 'utf-8'))
  if (tests.length === 0) throw new Error(`no test cases in ${testsPath}`)
  const fixture = tests[opts.caseIndex % tests.length]
  const inputs = fixture.inputs ?? {}
  const entities = fixture.entities
  // Run unrestricted so the engine has to evaluate the full graph (apples
  // to apples — both engines walk every reachable computation, just like
  // a real visualizer or API call).
  const readPaths: Set<string> | undefined = undefined

  // Phase 3: warmup. Not counted; primes JIT / scala.js Fact caches.
  for (let i = 0; i < opts.warmup; i++) {
    executeFactGraph(opts.ruleset, facts, inputs, model.nodes, entities, readPaths)
  }

  // Reset WASM-side per-phase counters AFTER warmup so they reflect
  // only the measured run. Scala.js executors leave these at 0.
  resetWasmTimings()

  // Phase 4: timed executes.
  const durations: number[] = []
  let firstOutputs: Record<string, unknown> | undefined
  const t0 = performance.now()
  for (let i = 0; i < opts.count; i++) {
    const s = performance.now()
    const out = executeFactGraph(
      opts.ruleset,
      facts,
      inputs,
      model.nodes,
      entities,
      readPaths
    )
    durations.push(performance.now() - s)
    if (i === 0) firstOutputs = out
  }
  const totalMs = performance.now() - t0

  durations.sort((a, b) => a - b)
  const mean = durations.reduce((a, b) => a + b, 0) / durations.length

  const result = {
    engine: opts.engine,
    ruleset: opts.ruleset,
    count: opts.count,
    warmup: opts.warmup,
    caseIndex: opts.caseIndex,
    coldMs: Number(coldMs.toFixed(3)),
    totalMs: Number(totalMs.toFixed(3)),
    meanMs: Number(mean.toFixed(4)),
    p50Ms: Number(percentile(durations, 50).toFixed(4)),
    p95Ms: Number(percentile(durations, 95).toFixed(4)),
    p99Ms: Number(percentile(durations, 99).toFixed(4)),
    minMs: Number(durations[0].toFixed(4)),
    maxMs: Number(durations[durations.length - 1].toFixed(4)),
    throughputPerSec: Number(((opts.count / totalMs) * 1000).toFixed(1)),
    // WASM-only phase breakdown (zero under Scala.js executors). Lets
    // the orchestrator decompose WASM overhead into JS↔WASM serde vs.
    // engine work.
    wasmInternal:
      wasmTimings.count > 0
        ? {
            deserializeMs: Number(
              (wasmTimings.deserializeMs / wasmTimings.count).toFixed(4)
            ),
            engineMs: Number(
              (wasmTimings.engineMs / wasmTimings.count).toFixed(4)
            ),
            serializeMs: Number(
              (wasmTimings.serializeMs / wasmTimings.count).toFixed(4)
            ),
          }
        : null,
    // Sanity: a few output paths so the orchestrator can cross-check
    // engines returned the same answers on the same inputs.
    outputSample: firstOutputs
      ? Object.fromEntries(
          Object.entries(firstOutputs)
            .slice(0, 5)
            .map(([k, v]) => [k, JSON.stringify(v)])
        )
      : {},
  }
  process.stdout.write(JSON.stringify(result))
}

main().catch((e) => {
  process.stderr.write(`worker error: ${(e as Error).stack ?? e}\n`)
  process.exit(1)
})
