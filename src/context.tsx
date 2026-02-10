import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { Model, ModelNode } from './lib/model'
import { generateId, createDefaultDecision } from './lib/model'

type MainContext = {
  model: Model
  setModel: Dispatch<SetStateAction<Model>>
}

const MainContext = createContext<MainContext | undefined>(undefined)

export function Wrapper({ children }: { children: React.ReactNode }) {
  const [model, setModel] = useState<Model>({
    id: generateId('model'),
    name: 'Benefits Eligibility',
    namespace: 'https://example.com/model',
    nodes: {
      test: createDefaultDecision('test', 'test'),
    },
  })

  return (
    <MainContext.Provider value={{ model, setModel }}>
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
