/**
 * Public surface of rules-visualizer-factgraph-core.
 *
 * Consumed by both the visualizer (`rules-visualizer-factgraph`) and the
 * partner-facing API server. Anything not exported here is internal and may
 * change without notice; treat this file as the package's API contract.
 */

// Execution
export { executeFactGraph, cacheStats, timings } from './executor.js'

// Ruleset store
export {
  loadFactGraphData,
  reloadRuleset,
  listRulesets,
  getRuleset,
  getRawFacts,
  getDataDir,
} from './store.js'
export type { RawFact } from './store.js'

// Parser (exposed so consumers can parse a single ruleset without going
// through the global store — useful for tests and one-off tooling).
export { parseFactGraphModules } from './parser.js'

// References resolution (exposed for callers that want to attach citations
// onto a model loaded outside the global store).
export { resolveReferences } from './references.js'
