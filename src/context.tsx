import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { Model, ModelNode, ModelNodes } from './lib/model'
import { generateId, createDefaultDecision } from './lib/model'

type MainContext = {
  model: Model
  setModel: Dispatch<SetStateAction<Model>>
  hoveredNodeId: string | null
  setHoveredNodeId: Dispatch<SetStateAction<string | null>>
  selectedNodes: string[]
  setSelectedNodes: Dispatch<SetStateAction<string[]>>
  showChildren: Record<string, boolean>
  setShowChildren: Dispatch<SetStateAction<Record<string, boolean>>>
}

const MainContext = createContext<MainContext | undefined>(undefined)

// FIXME: For testing only
function createInitialNodes(count: number): ModelNodes {
  const nodes: ModelNodes = {}
  const ids: string[] = []

  for (let i = 0; i < count; i++) {
    const id = Math.random().toString()
    const node = createDefaultDecision(id, id)

    if (ids.length > 0) {
      node.dependencies = [ids[Math.floor(Math.random() * ids.length)]]
    }

    nodes[id] = node
    ids.push(id)
  }

  return nodes
}

export function Wrapper({ children }: { children: React.ReactNode }) {
  const [model, setModel] = useState<Model>({
    id: generateId('model'),
    name: 'Benefits Eligibility',
    namespace: 'https://example.com/model',
    nodes: createInitialNodes(5),
  })
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [selectedNodes, setSelectedNodes] = useState<string[]>([])
  const [showChildren, setShowChildren] = useState<Record<string, boolean>>({})

  return (
    <MainContext.Provider
      value={{
        model,
        setModel,
        hoveredNodeId,
        setHoveredNodeId,
        selectedNodes,
        setSelectedNodes,
        showChildren,
        setShowChildren,
      }}
    >
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

export function useNode(id: string): ModelNode {
  const { model } = useMainContext()

  const node = model.nodes[id]

  if (node === undefined) {
    throw new Error(`Node with id '${id}' not found`)
  }

  return node
}

export function useUpdateNode() {
  const { setModel } = useMainContext()

  return (id: string, updater: (node: ModelNode) => ModelNode) => {
    setModel((model) => ({
      ...model,
      nodes: {
        ...model.nodes,
        [id]: updater(model.nodes[id]),
      },
    }))
  }
}

export function useAddNode() {
  const { setModel } = useMainContext()

  return (id: string, node: ModelNode) => {
    setModel((model) => ({
      ...model,
      nodes: {
        ...model.nodes,
        [id]: node,
      },
    }))
  }
}

export function useIsHoveredRelated(id: string) {
  const { hoveredNodeId, model } = useMainContext()
  const nodes = model.nodes

  if (hoveredNodeId === id) {
    return true
  }

  const node = nodes[id]
  const hoveredNode = nodes[hoveredNodeId ?? '']

  if (hoveredNode === undefined) {
    return true
  }

  const hoveredDeps =
    hoveredNode.type === 'decision' ? hoveredNode.dependencies : []
  const nodeDeps = node.type === 'decision' ? node.dependencies : []

  if (hoveredDeps.includes(id)) {
    return true
  }

  if (nodeDeps.includes(hoveredNodeId ?? '')) {
    return true
  }

  return false
}
