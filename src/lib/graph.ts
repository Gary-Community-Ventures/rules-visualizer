import type { ModelNode, ModelNodes } from './model'

function getNodeDependencies(node: ModelNode): string[] {
  return node.type === 'decision' ? node.dependencies : []
}

export function findRootNodes(nodes: ModelNodes): string[] {
  return Object.entries(nodes)
    .filter(([_, node]) => getNodeDependencies(node).length === 0)
    .map(([id]) => id)
}

export function getDependents(nodeId: string, nodes: ModelNodes): string[] {
  return Object.entries(nodes)
    .filter(([_, node]) => getNodeDependencies(node).includes(nodeId))
    .map(([id]) => id)
}

// WARN: Does not handle circular dependencies
function getOrdering(
  currentNode: string,
  currentOrdering: string[],
  nodes: ModelNodes,
  showChildren: Record<string, boolean>
): string[] {
  const dependents = getDependents(currentNode, nodes)

  if (!showChildren[currentNode]) {
    return currentOrdering
  }

  for (const dependent of dependents) {
    const index = currentOrdering.indexOf(dependent)
    if (index !== -1) {
      currentOrdering.splice(index, 1)
    }
    currentOrdering.push(dependent)

    getOrdering(dependent, currentOrdering, nodes, showChildren)
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

        let dependsOnPreviousRow = false
        for (const previousItem of previousRow) {
          if (
            getNodeDependencies(nodes[item]).includes(previousItem) &&
            showChildren[previousItem]
          ) {
            dependsOnPreviousRow = true
            break
          }
        }

        if (dependsOnPreviousRow) {
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
