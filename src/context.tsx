import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { Nodes } from './lib/nodes'

type MainContext = {
  nodes: Nodes
  setNodes: Dispatch<SetStateAction<Nodes>>
}

const MainContext = createContext<MainContext | undefined>(undefined)

export function Wrapper({ children }: { children: React.ReactNode }) {
  const [nodes, setNodes] = useState<Nodes>({
    test: {
      dependencies: [],
      rule: {
        type: 'context',
        entries: [
          {
            name: 'a',
            feel: '1',
          },
          {
            name: '_return',
            feel: 'a + 1',
          },
        ],
      },
    },
  })

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
