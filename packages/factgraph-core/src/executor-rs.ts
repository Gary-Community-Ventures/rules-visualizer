/**
 * factgraph-rs WASM executor — drop-in replacement for executor.ts.
 *
 * Reads the source XML directly from disk via the data dir stashed on
 * `globalThis` by `loadFactGraphData`. Deliberately avoids importing
 * anything from `./store.js` because under tsx + symlinked
 * node_modules ESM can load the same file via two URLs, producing two
 * module instances with their own state and silently desyncing.
 *
 * The function signature mirrors `executor.ts` so callers can swap by
 * changing the package's index export.
 */

import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import type { ParsedFact } from './parser.js'

const require = createRequire(import.meta.url)
type FactGraphHandle = {
  factCount: number
  execute(request: ExecuteRequest): Record<string, unknown>
  free(): void
}
type WasmModule = {
  FactGraph: new (xml: string) => FactGraphHandle
}
const wasm: WasmModule = require('../vendor/factgraph-rs/factgraph_wasm.js') as WasmModule

type ExecuteRequest = {
  inputs: Record<string, unknown>
  entities: Record<string, Record<string, unknown>[]>
  read_paths?: string[]
}

// Handles cached per ruleset. Anchored on globalThis so it survives
// Node ESM's dual-load-of-the-same-file pitfall.
type GlobalWithHandles = typeof globalThis & {
  __rulesVisualizerWasmHandles?: Map<string, FactGraphHandle>
}
const _g = globalThis as GlobalWithHandles
const handles: Map<string, FactGraphHandle> =
  _g.__rulesVisualizerWasmHandles ?? (_g.__rulesVisualizerWasmHandles = new Map())

function getDataDir(): string | undefined {
  return process.env.RULES_VISUALIZER_DATA_DIR
}

/**
 * Read the source XML for a ruleset from disk and concatenate modules
 * (rulesets that ship as multiple `<FactDictionaryModule>` files merge
 * into one). Returns `undefined` if the ruleset directory isn't found
 * or contains no XML.
 */
function readRulesetXml(rulesetId: string): string | undefined {
  const dataDir = getDataDir()
  if (!dataDir) return undefined
  const rulesetDir = path.join(dataDir, rulesetId)
  if (!fs.existsSync(rulesetDir) || !fs.statSync(rulesetDir).isDirectory()) {
    return undefined
  }
  const xmlFiles = fs.readdirSync(rulesetDir).filter((f) => f.endsWith('.xml'))
  if (xmlFiles.length === 0) return undefined
  if (xmlFiles.length === 1) {
    return fs.readFileSync(path.join(rulesetDir, xmlFiles[0]), 'utf-8')
  }
  const buf: string[] = ['<FactDictionaryModule>', '  <Facts>']
  for (const file of xmlFiles) {
    const xml = fs.readFileSync(path.join(rulesetDir, file), 'utf-8')
    const openIdx = xml.indexOf('<Facts>')
    const closeIdx = xml.lastIndexOf('</Facts>')
    if (openIdx === -1 || closeIdx === -1 || closeIdx < openIdx) continue
    buf.push(xml.slice(openIdx + '<Facts>'.length, closeIdx).trim())
  }
  buf.push('  </Facts>', '</FactDictionaryModule>')
  return buf.join('\n')
}

function getOrCreateHandle(rulesetId: string): FactGraphHandle | undefined {
  let h = handles.get(rulesetId)
  if (h) return h
  const xml = readRulesetXml(rulesetId)
  if (!xml) return undefined
  h = new wasm.FactGraph(xml)
  handles.set(rulesetId, h)
  return h
}

/**
 * Drop a cached handle when a ruleset is reloaded so the next execute
 * picks up the new XML. Called by the file watcher's reload path.
 */
export function dropCachedHandle(rulesetId: string): void {
  const h = handles.get(rulesetId)
  if (h) {
    h.free()
    handles.delete(rulesetId)
  }
}

// API-compat re-exports — the WASM backend doesn't track these stats today.
export const cacheStats = { hits: 0, misses: 0 }
export const timings = {
  dict: 0,
  graphInit: 0,
  collections: 0,
  scalarInputs: 0,
  read: 0,
  total: 0,
  count: 0,
}
export const factCallCounts = new Map<string, number>()
export function resetFactCallCounts(): void {
  factCallCounts.clear()
}
export const graphSetTimings = { elapsedMs: 0, count: 0 }
export function resetGraphSetTimings(): void {
  graphSetTimings.elapsedMs = 0
  graphSetTimings.count = 0
}

/**
 * Execute a fact graph ruleset against the given inputs and entities.
 *
 * @param rulesetId - read from `<dataDir>/<rulesetId>/*.xml`
 * @param facts - unused by the WASM backend (kept for signature parity)
 * @param inputs - scalar input values by full fact path
 * @param modelNodes - unused (WASM infers types from XML)
 * @param entities - per-collection rows, each row keyed by full fact path
 * @param readPaths - optional whitelist of output paths
 */
export function executeFactGraph(
  rulesetId: string,
  facts: ParsedFact[],
  inputs: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  modelNodes?: Record<string, { content: { dataType?: string } }>,
  entities?: Record<string, Record<string, unknown>[]>,
  readPaths?: Set<string>
): Record<string, unknown> {
  void facts
  const t0 = Date.now()
  const handle = getOrCreateHandle(rulesetId)
  if (!handle) {
    console.warn(
      `executeFactGraph (rs): no XML found on disk for ruleset "${rulesetId}". ` +
        `dataDir=${getDataDir() ?? '<unset>'}. Returning {}.`
    )
    return {}
  }

  const request: ExecuteRequest = {
    inputs: inputs ?? {},
    entities: entities ?? {},
  }
  if (readPaths && readPaths.size > 0) {
    request.read_paths = Array.from(readPaths)
  }

  const result = handle.execute(request) as Record<string, unknown>
  timings.total += Date.now() - t0
  timings.count++
  return result
}

/**
 * Debug-only — exposes the underlying handle for direct inspection.
 * The Scala.js backend's `__debugBuildGraph` returns a graph object with
 * `getFact()` for `Fact.explain()` walks; the WASM backend doesn't have
 * an analog yet. Kept for signature parity; returns an empty stub.
 */
export function __debugBuildGraph(facts: ParsedFact[]): {
  graph: { getFact: (path: string) => Record<string, unknown> }
} {
  void facts
  return {
    graph: {
      getFact: () => ({}),
    },
  }
}
