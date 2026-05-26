/**
 * Derived lookup tables for a parsed Fact Graph Model, cached per Model
 * identity. The query route consults these on every request; without
 * caching each request paid for an O(n) iteration of `Object.values
 * (model.nodes)` for path lookups plus a full reverse-dependency rebuild
 * inside `clearUnprovidedCollectionSubtrees`. On big rulesets (tax-
 * withholding-estimator has 948 nodes) that adds up across multi-target
 * requests.
 *
 * Cache key is the Model object itself, held by a WeakMap. When the
 * visualizer's file watcher reloads a ruleset the store swaps in a new
 * Model object — the old one becomes unreachable, the WeakMap entry is
 * GC'd, and the next request rebuilds the index against the new Model.
 * No manual invalidation needed.
 */
import type { Model, ModelNode } from 'rules-visualizer-shared-types'

export type ModelIndex = {
  /** Fact path → ModelNode. Replaces O(n) `Object.values(...).find(...)` scans. */
  pathToNode: Map<string, ModelNode>
  /** Node id → ids of nodes that list it as a dependency. Powers the
   *  unprovided-collection backfill BFS without rebuilding per request. */
  reverseDeps: Map<string, string[]>
  /** Every collection root discovered from `/<root>/*\/...` fact paths.
   *  Empty when the ruleset has no collection-scoped writables. */
  collectionRoots: Set<string>
  /** For each collection root, the set of model nodes whose path lives
   *  under that root (the root itself plus per-member facts). Used as
   *  the seed set for the reverse-dependency BFS in
   *  `clearUnprovidedCollectionSubtrees`. */
  collectionRootSeeds: Map<string, ModelNode[]>
}

const cache = new WeakMap<Model, ModelIndex>()

export function getModelIndex(model: Model): ModelIndex {
  let entry = cache.get(model)
  if (entry) return entry
  entry = buildModelIndex(model)
  cache.set(model, entry)
  return entry
}

function buildModelIndex(model: Model): ModelIndex {
  const pathToNode = new Map<string, ModelNode>()
  const reverseDeps = new Map<string, string[]>()
  const collectionRoots = new Set<string>()

  // One pass to fill the three maps that only need a single visit each
  // node. We derive the collection root from any path containing the
  // wildcard segment — the Fact Graph parser does not surface the
  // collection writable itself as a separate node, so we infer the
  // root from per-member fact paths.
  for (const node of Object.values(model.nodes)) {
    const content = node.content
    if (content.type !== 'entity' && 'path' in content) {
      pathToNode.set(content.path, node)
      const match = content.path.match(/^(\/[^*]+?)\/\*\//)
      if (match) collectionRoots.add(match[1])
    }
    for (const depId of node.dependencies) {
      const list = reverseDeps.get(depId) ?? []
      list.push(node.id)
      reverseDeps.set(depId, list)
    }
  }

  // Seed sets per collection root. Pre-grouped so the BFS in
  // clearUnprovidedCollectionSubtrees can pull only the seeds it
  // actually needs (subset of unprovided roots) without re-scanning
  // every node.
  const collectionRootSeeds = new Map<string, ModelNode[]>()
  if (collectionRoots.size > 0) {
    for (const root of collectionRoots) {
      collectionRootSeeds.set(root, [])
    }
    for (const node of Object.values(model.nodes)) {
      const content = node.content
      if (content.type === 'entity' || !('path' in content)) continue
      for (const root of collectionRoots) {
        if (content.path === root || content.path.startsWith(root + '/')) {
          collectionRootSeeds.get(root)!.push(node)
          break
        }
      }
    }
  }

  return { pathToNode, reverseDeps, collectionRoots, collectionRootSeeds }
}
