import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { createDefaultNode, type Nodes, type Node } from './lib/nodes'

type MainContext = {
  nodes: Nodes
  setNodes: Dispatch<SetStateAction<Nodes>>
}

const MainContext = createContext<MainContext | undefined>(undefined)

// FIXME: For testing only
function createInitialNodes(count: number): Nodes {
  const nodes: Nodes = {}
  const ids: string[] = []

  for (let i = 0; i < count; i++) {
    const id = Math.random().toString()
    const node = createDefaultNode('context')

    // First node has no dependencies, others randomly depend on an existing node
    if (ids.length > 0) {
      node.dependencies = [ids[Math.floor(Math.random() * ids.length)]]
    }

    nodes[id] = node
    ids.push(id)
  }

  return nodes
}

export function Wrapper({ children }: { children: React.ReactNode }) {
  const [nodes, setNodes] = useState<Nodes>(() => createInitialNodes(5))

  return (
    <MainContext.Provider value={{ nodes, setNodes }}>
      {children}
    </MainContext.Provider>
  )
}

export function useMainContext(): MainContext {
  const context = useContext(MainContext)

  if (context === undefined) {
    throw new Error("'useMainContext' must be used within the Wrapper")
  }

  return context
}

export function useNode(id: string) {
  const { nodes } = useMainContext()

  const node = nodes[id]

  if (node === undefined) {
    throw new Error(`Node with id '${id}' not found`)
  }

  return node
}

export function useUpdateNode() {
  const { setNodes } = useMainContext()

  return (id: string, update: Partial<Node>) => {
    setNodes((nodes) => {
      return {
        ...nodes,
        [id]: {
          ...nodes[id],
          ...update,
        },
      }
    })
  }
}

export function useAddNode() {
  const { setNodes } = useMainContext()

  return (id: string, node: Node) => {
    setNodes((nodes) => {
      return {
        ...nodes,
        [id]: node,
      }
    })
  }
}
