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

// WARN: Does not handle circular dependencies
function getOrdering(
  currentNode: string,
  currentOrdering: string[],
  nodes: ModelNodes,
  showChildren: Record<string, boolean>
): string[] {
  const children = nodes[currentNode]?.dependencies ?? []

  if (!showChildren[currentNode]) {
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
            showChildren[previousItem]
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
