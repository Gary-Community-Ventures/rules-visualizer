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
export function getAllDependencies(nodeId: string, nodes: ModelNodes): string[] {
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
 * Compute the depth (longest path from any root) for each node.
 * Uses iterative topological-sort BFS so it handles large graphs.
 */
function computeDepths(nodes: ModelNodes): Map<string, number> {
  const depth = new Map<string, number>()

  // Build reverse-dep map: child -> parents that list it as a dependency
  const parents = new Map<string, string[]>()
  const inDegree = new Map<string, number>()

  for (const id of Object.keys(nodes)) {
    parents.set(id, [])
    inDegree.set(id, 0)
  }

  for (const [id, node] of Object.entries(nodes)) {
    for (const dep of node.dependencies) {
      if (nodes[dep]) {
        parents.get(dep)!.push(id)
        inDegree.set(id, (inDegree.get(id) ?? 0) + 1)
      }
    }
  }

  // BFS from leaves (nodes with no dependencies) upward
  // Actually, we want depth from roots downward. Use Kahn's from roots.
  // Roots = nodes with inDegree 0 (nothing depends on them... wait, that's wrong)
  //
  // We want: depth[node] = 0 for roots, depth[dep] = max(depth[parent] + 1) for deps.
  // Process top-down: start from roots (not depended on by anything),
  // propagate depth to their dependencies.

  const dependedOn = new Set<string>()
  for (const node of Object.values(nodes)) {
    for (const dep of node.dependencies) {
      dependedOn.add(dep)
    }
  }

  const queue: string[] = []
  for (const id of Object.keys(nodes)) {
    if (!dependedOn.has(id)) {
      depth.set(id, 0)
      queue.push(id)
    }
  }

  // BFS: assign each child the max depth of its parents + 1
  let head = 0
  while (head < queue.length) {
    const id = queue[head++]
    const d = depth.get(id)!
    const node = nodes[id]
    if (!node) continue

    for (const dep of node.dependencies) {
      if (!nodes[dep]) continue
      const prevDepth = depth.get(dep) ?? -1
      if (d + 1 > prevDepth) {
        depth.set(dep, d + 1)
      }
      // Decrement in-degree; when 0, all parents processed
      const remaining = inDegree.get(dep)! - 1
      inDegree.set(dep, remaining)
      if (remaining === 0) {
        queue.push(dep)
      }
    }
  }

  // Handle any nodes not reached (cycles or disconnected) — give them depth 0
  for (const id of Object.keys(nodes)) {
    if (!depth.has(id)) {
      depth.set(id, 0)
    }
  }

  return depth
}

export function nodeRows(
  nodes: ModelNodes,
  showChildren: Record<string, boolean>,
  selected?: string[]
): string[][] {
  const nodeCount = Object.keys(nodes).length

  // For large graphs, use depth-based layout (fast, O(V+E))
  // For small graphs, keep the original interactive layout
  if (nodeCount > 500) {
    return nodeRowsLarge(nodes, showChildren, selected)
  }

  return nodeRowsSmall(nodes, showChildren, selected)
}

/**
 * Fast depth-based layout for large graphs.
 * Groups nodes by their depth (longest path from root).
 */
function nodeRowsLarge(
  nodes: ModelNodes,
  showChildren: Record<string, boolean>,
  selected?: string[]
): string[][] {
  // If specific nodes selected, filter to reachable subgraph
  let activeNodes: ModelNodes
  if (selected && selected.length > 0) {
    const reachable = new Set<string>()
    const stack = [...selected]
    while (stack.length > 0) {
      const id = stack.pop()!
      if (reachable.has(id) || !nodes[id]) continue
      reachable.add(id)
      if (showChildren[id] === true) {
        for (const dep of nodes[id].dependencies) {
          stack.push(dep)
        }
      }
    }
    activeNodes = {}
    for (const id of reachable) {
      activeNodes[id] = nodes[id]
    }
  } else {
    // Respect collapsed nodes
    const visible = new Set<string>()
    const dependedOn = new Set<string>()
    for (const node of Object.values(nodes)) {
      for (const dep of node.dependencies) dependedOn.add(dep)
    }
    // Start from roots and walk, skipping collapsed subtrees
    const roots = Object.keys(nodes).filter((id) => !dependedOn.has(id))
    const stack = [...roots]
    while (stack.length > 0) {
      const id = stack.pop()!
      if (visible.has(id) || !nodes[id]) continue
      visible.add(id)
      if (showChildren[id] === true) {
        for (const dep of nodes[id].dependencies) {
          stack.push(dep)
        }
      }
    }
    activeNodes = {}
    for (const id of visible) {
      activeNodes[id] = nodes[id]
    }
  }

  const depths = computeDepths(activeNodes)

  // Group by depth
  const rowMap = new Map<number, string[]>()
  for (const [id, d] of depths) {
    if (!rowMap.has(d)) rowMap.set(d, [])
    rowMap.get(d)!.push(id)
  }

  // Sort by depth, then alphabetically within each row
  const maxDepth = Math.max(...rowMap.keys(), 0)
  const rows: string[][] = []
  for (let d = 0; d <= maxDepth; d++) {
    const row = rowMap.get(d)
    if (row && row.length > 0) {
      row.sort((a, b) =>
        (activeNodes[a]?.name ?? '').localeCompare(activeNodes[b]?.name ?? '')
      )
      rows.push(row)
    }
  }

  return rows
}

/**
 * Original interactive layout for small graphs.
 * Uses recursive ordering + row compression.
 */
function nodeRowsSmall(
  nodes: ModelNodes,
  showChildren: Record<string, boolean>,
  selected?: string[]
): string[][] {
  let roots: string[]
  if (selected === undefined || selected.length === 0) {
    roots = findRootNodes(nodes)
  } else {
    roots = selected
  }

  if (roots.length === 0) {
    return []
  }

  const ordering = [...roots]

  for (const root of roots) {
    getOrdering(root, ordering, nodes, showChildren)
  }

  const rows = ordering.map((node) => [node])

  return compressRows(rows, nodes, showChildren)
}

// WARN: Does not handle circular dependencies
function getOrdering(
  currentNode: string,
  currentOrdering: string[],
  nodes: ModelNodes,
  showChildren: Record<string, boolean>
): string[] {
  const children = nodes[currentNode]?.dependencies ?? []

  if (showChildren[currentNode] !== true) {
    return currentOrdering
  }

  for (const child of children) {
    if (!nodes[child]) continue
    const index = currentOrdering.indexOf(child)
    if (index !== -1) {
      currentOrdering.splice(index, 1)
    }
    currentOrdering.push(child)

    getOrdering(child, currentOrdering, nodes, showChildren)
  }

  return currentOrdering
}

function compressRows(
  rows: string[][],
  nodes: ModelNodes,
  showChildren: Record<string, boolean>
): string[][] {
  let changed = true
  while (changed) {
    changed = false
    for (let i = rows.length - 1; i > 0; i--) {
      const row = rows[i]
      const previousRow = rows[i - 1]

      for (let j = row.length - 1; j >= 0; j--) {
        const item = row[j]

        let neededByPreviousRow = false
        for (const previousItem of previousRow) {
          if (
            nodes[previousItem]?.dependencies.includes(item) &&
            showChildren[previousItem] === true
          ) {
            neededByPreviousRow = true
            break
          }
        }

        if (neededByPreviousRow) {
          continue
        }

        row.splice(j, 1)
        previousRow.push(item)
        changed = true
      }
    }

    rows = rows.filter((row) => row.length > 0)
  }

  return rows
}
