/**
 * Legacy node types — kept for backward compatibility with existing
 * graph-view work. Migrate to src/lib/dmn/ when ready.
 *
 * @deprecated Use types from '@/lib/model' instead.
 */

export type Node = {
  rule: Context
  dependencies: string[]
}

export type Types = 'context'

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

export function createDefaultNode(): Node {
  return {
    rule: {
      type: 'context',
      entries: [],
    },
    dependencies: [],
  }
}
