import type { ModelNodes } from './model'

export function findRootNodes(nodes: ModelNodes): string[] {
  const dependedOn = new Set<string>()
  for (const node of Object.values(nodes)) {
    for (const dep of node.dependencies) {
      dependedOn.add(dep)
    }
  }
  return Object.keys(nodes).filter((id) => !dependedOn.has(id))
}

export function getLeafNodes(nodes: ModelNodes): string[] {
  return Object.keys(nodes).filter((id) => nodes[id].dependencies.length === 0)
}

export function getDependents(nodeId: string, nodes: ModelNodes): string[] {
  return Object.entries(nodes)
    .filter(([_, node]) => node.dependencies.includes(nodeId))
    .map(([id]) => id)
}

/** Collect all transitive dependencies of a node */
export function getAllDependencies(
  nodeId: string,
  nodes: ModelNodes
): string[] {
  const result = new Set<string>()
  const stack = [nodeId]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (result.has(id)) continue
    result.add(id)
    for (const dep of nodes[id]?.dependencies ?? []) {
      if (nodes[dep] && !result.has(dep)) stack.push(dep)
    }
  }
  result.delete(nodeId)
  return [...result]
}

/** Collect all transitive dependents of a node */
export function getAllDependents(nodeId: string, nodes: ModelNodes): string[] {
  const result = new Set<string>()
  const stack = [nodeId]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (result.has(id)) continue
    result.add(id)
    for (const dep of getDependents(id, nodes)) {
      if (!result.has(dep)) stack.push(dep)
    }
  }
  result.delete(nodeId)
  return [...result]
}

/**
 * Compute the rows for the graph layout.
 *
 * Pipeline:
 *   1. Build active subgraph (filter by selected if given, respect showChildren)
 *   2. Break cycles by removing back-edges from a DFS
 *   3. Kahn's topological sort, but break to a new row whenever a node has
 *      a parent already in the current row
 */
export function nodeRows(
  nodes: ModelNodes,
  showChildren: Record<string, boolean>,
  selected?: string[]
): string[][] {
  // 1. Active subgraph as id -> Set<dependencyId>. New data structure, no mutation of input.
  const graph = buildActiveSubgraph(nodes, showChildren, selected)
  if (graph.size === 0) return []

  // 2. Remove back-edges to break cycles
  breakCycles(graph)

  // 3. Layered Kahn's topological sort
  return assignRows(graph)
}

function buildActiveSubgraph(
  nodes: ModelNodes,
  showChildren: Record<string, boolean>,
  selected?: string[]
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>()
  const isExpanded = (id: string) => showChildren[id] === true

  // Determine starting nodes: selected if given, else true roots (no parents)
  let starts: string[]
  if (selected && selected.length > 0) {
    starts = selected.filter((id) => nodes[id])
  } else {
    const dependedOn = new Set<string>()
    for (const node of Object.values(nodes)) {
      for (const dep of node.dependencies) dependedOn.add(dep)
    }
    starts = Object.keys(nodes).filter((id) => !dependedOn.has(id))
  }

  // BFS from starts; only follow edges when the parent is expanded.
  // Children whose parents are all collapsed never get added.
  const stack = [...starts]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (graph.has(id) || !nodes[id]) continue
    const deps = new Set<string>()
    if (isExpanded(id)) {
      for (const dep of nodes[id].dependencies) {
        if (nodes[dep]) {
          deps.add(dep)
          stack.push(dep)
        }
      }
    }
    graph.set(id, deps)
  }
  return graph
}

/** Remove edges that close cycles. DFS; any edge to a node currently on the stack is a back-edge. */
function breakCycles(graph: Map<string, Set<string>>): void {
  const visited = new Set<string>()
  const stack = new Set<string>()

  function dfs(id: string) {
    if (visited.has(id)) return
    visited.add(id)
    stack.add(id)
    const deps = graph.get(id)
    if (deps) {
      for (const dep of [...deps]) {
        if (stack.has(dep)) {
          deps.delete(dep) // back-edge — remove
        } else {
          dfs(dep)
        }
      }
    }
    stack.delete(id)
  }

  for (const id of graph.keys()) dfs(id)
}

/**
 * Kahn's algorithm with row-breaking twist.
 * Nodes flow into the current row until one's parent is already there, then start a new row.
 */
function assignRows(graph: Map<string, Set<string>>): string[][] {
  // Build reverse adjacency: dependents (parents in display order)
  const dependents = new Map<string, Set<string>>()
  for (const id of graph.keys()) dependents.set(id, new Set())
  for (const [id, deps] of graph) {
    for (const dep of deps) {
      dependents.get(dep)?.add(id)
    }
  }

  // In-degree = number of nodes that depend on this one. Process top-down (parents first).
  const inDegree = new Map<string, number>()
  for (const [id, parents] of dependents) inDegree.set(id, parents.size)

  // Use index-based queue (avoid O(n) shift)
  const queue: string[] = []
  for (const [id, d] of inDegree) {
    if (d === 0) queue.push(id)
  }

  const rows: string[][] = []
  let currentRow: string[] = []
  let currentRowSet = new Set<string>()
  let head = 0

  while (head < queue.length) {
    const id = queue[head++]

    // Does this node have a parent in the current row? If so, start a new row.
    let parentInCurrentRow = false
    for (const p of dependents.get(id) ?? []) {
      if (currentRowSet.has(p)) {
        parentInCurrentRow = true
        break
      }
    }
    if (parentInCurrentRow) {
      rows.push(currentRow)
      currentRow = []
      currentRowSet = new Set()
    }

    currentRow.push(id)
    currentRowSet.add(id)

    for (const dep of graph.get(id) ?? []) {
      const d = (inDegree.get(dep) ?? 0) - 1
      inDegree.set(dep, d)
      if (d === 0) queue.push(dep)
    }
  }

  if (currentRow.length > 0) rows.push(currentRow)
  return rows
}
