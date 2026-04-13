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

export function nodeRows(
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

function getOrdering(
  currentNode: string,
  currentOrdering: string[],
  nodes: ModelNodes,
  showChildren: Record<string, boolean>,
  visited?: Set<string>
): string[] {
  if (!visited) visited = new Set<string>()
  if (visited.has(currentNode)) return currentOrdering
  visited.add(currentNode)

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

    getOrdering(child, currentOrdering, nodes, showChildren, visited)
  }

  return currentOrdering
}

function compressRows(
  rows: string[][],
  nodes: ModelNodes,
  showChildren: Record<string, boolean>
): string[][] {
  // Build a set of "blocked" pairs: item X is blocked from being above row R
  // if row R contains a node that depends on X (with children shown).
  // For each node, find the highest row it can move to in a single forward pass.

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    for (let j = row.length - 1; j >= 0; j--) {
      const item = row[j]

      // Scan upward to find the highest row this node can sit in.
      // It must stay below any row that contains a parent depending on it.
      let target = 0
      for (let r = 0; r < i; r++) {
        for (const other of rows[r]) {
          if (
            nodes[other]?.dependencies.includes(item) &&
            showChildren[other] === true
          ) {
            target = r + 1
          }
        }
      }

      if (target < i) {
        row.splice(j, 1)
        rows[target].push(item)
      }
    }
  }

  return rows.filter((row) => row.length > 0)
}
