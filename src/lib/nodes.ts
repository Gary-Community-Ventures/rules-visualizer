import { Agent } from 'http'

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

export function createDefaultNode(type): Node {
  return {
    rule: {
      type: 'context',
      entries: [],
    },
    dependencies: [],
  }
}
