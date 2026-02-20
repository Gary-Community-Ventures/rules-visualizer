import { deepCopy } from './utils'
import type { Model, ModelNode, ModelNodes, NodeContent } from './model'

export function findRootNodes(nodes: ModelNodes): string[] {
  // Root nodes are outputs — nodes that no other node depends on
  const dependedOn = new Set<string>()
  for (const node of Object.values(nodes)) {
    for (const dep of node.dependencies) {
      dependedOn.add(dep)
    }
  }
  return Object.keys(nodes).filter((id) => !dependedOn.has(id))
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
  // Expand into dependencies (what this node needs) — they appear below
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

        // Can't move up if a node in the row above depends on this item
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

export function addNodeDependencies(
  a: ModelNodes,
  b: ModelNode[] | undefined
): ModelNodes {
  const nodes = deepCopy(a)

  for (const node of b ?? []) {
    const id = node.id
    if (id in nodes) {
      nodes[id] = {
        ...nodes[id],
        dependencies: [...nodes[id].dependencies, ...node.dependencies],
      }
    } else {
      nodes[id] = node
    }
  }

  return nodes
}

export function extractFeelText(content: NodeContent): string[] {
  switch (content.type) {
    case 'input':
    case 'constant':
      return []
    case 'context':
      return content.entries.map((e) => e.expression.text)
    case 'decisionTable':
      return [
        ...content.inputClauses.map((c) => c.inputExpression),
        ...content.rules.flatMap((r) => [
          ...r.inputEntries,
          ...r.outputEntries,
        ]),
      ]
  }
}

export function computeNodeDependencies(
  content: NodeContent,
  nameToId: Map<string, string>,
  selfId: string
): string[] {
  const texts = extractFeelText(content)
  const depIds = new Set<string>()

  for (const text of texts) {
    for (const [name, id] of nameToId) {
      if (id === selfId || name === '') continue
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`\\b${escaped}\\b`)
      if (re.test(text)) {
        depIds.add(id)
      }
    }
  }

  return [...depIds]
}

export function applyDiffs(model: Model, diffs: ModelNode[]): Model {
  const result = deepCopy(model)

  for (const diff of diffs) {
    if (diff.deletedVersion !== undefined) {
      delete result.nodes[diff.id]
    } else {
      result.nodes[diff.id] = deepCopy(diff)
    }
  }

  return result
}

export function buildNameToIdMap(
  nodes: ModelNodes,
  diffs?: ModelNode[]
): Map<string, string> {
  const nameToId = new Map<string, string>()
  for (const node of Object.values(nodes)) {
    nameToId.set(node.name, node.id)
  }
  for (const diff of diffs ?? []) {
    nameToId.set(diff.name, diff.id)
  }
  return nameToId
}

function depsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((v, i) => v === sortedB[i])
}

export function recomputeDependencies<T extends ModelNode>(
  nodes: T[],
  nameToId: Map<string, string>
): { nodes: T[]; changed: boolean } {
  let changed = false
  const updated = nodes.map((node) => {
    const newDeps = computeNodeDependencies(node.content, nameToId, node.id)
    if (!depsEqual(node.dependencies, newDeps)) {
      changed = true
      return { ...node, dependencies: newDeps }
    }
    return node
  })
  return { nodes: updated, changed }
}
