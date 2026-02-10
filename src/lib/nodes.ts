export type Node = {
  rule: Rule
  dependencies: string[]
  showChildren: boolean
}

export type Types = 'context'
export type Rule = Context

export type Context = {
  type: 'context'
  entries: ContextEntry[]
}

export type ContextEntry = {
  id: string
  type: 'number' | 'string' | 'date'
  name: string
  feel: string
}

export type Nodes = {
  [key: string]: Node
}

export function createDefaultNode(type: Types): Node {
  let rule: Rule
  if (type === 'context') {
    rule = {
      type: 'context',
      entries: [],
    }
  } else {
    throw new Error(`Unknown node type '${type}'`)
  }

  return {
    rule: rule,
    dependencies: [],
    showChildren: false,
  }
}

export function findRootNodes(nodes: Nodes): string[] {
  return Object.entries(nodes)
    .filter(([_, node]) => node.dependencies.length === 0)
    .map(([id]) => id)
}

export function getDependents(nodeId: string, nodes: Nodes): string[] {
  return Object.entries(nodes)
    .filter(([_, node]) => node.dependencies.includes(nodeId))
    .map(([id]) => id)
}

// WARN: Does not handle circular dependencies
function getOrdering(
  currentNode: string,
  currentOrdering: string[],
  nodes: Nodes
): string[] {
  const dependents = getDependents(currentNode, nodes)

  if (!nodes[currentNode].showChildren) {
    return currentOrdering
  }

  for (const dependent of dependents) {
    const index = currentOrdering.indexOf(dependent)
    if (index !== -1) {
      // if dependent is already in currentOrdering remove it and move it to the end
      currentOrdering.splice(index, 1)
    }
    currentOrdering.push(dependent)

    getOrdering(dependent, currentOrdering, nodes)
  }

  return currentOrdering
}

function compressRows(rows: string[][], nodes: Nodes): string[][] {
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
            nodes[item].dependencies.includes(previousItem) &&
            nodes[previousItem].showChildren
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

export function nodeRows(nodes: Nodes): string[][] {
  const roots = findRootNodes(nodes)

  if (roots.length === 0) {
    return []
  }

  const ordering = [...roots]

  for (const root of roots) {
    getOrdering(root, ordering, nodes)
  }

  const rows = ordering.map((node) => [node])

  return compressRows(rows, nodes)
}
