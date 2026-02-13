import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { Model, ModelNode } from './lib/model'
import type { ExecutionResult, NodeResult } from './lib/engine'
import { createDemoModel } from './lib/demo-data'

type MainContext = {
  model: Model
  setModel: Dispatch<SetStateAction<Model>>
  hoveredNodeId: string | null
  setHoveredNodeId: Dispatch<SetStateAction<string | null>>
  selectedNodes: string[]
  setSelectedNodes: Dispatch<SetStateAction<string[]>>
  showChildren: Record<string, boolean>
  setShowChildren: Dispatch<SetStateAction<Record<string, boolean>>>
  openNode: string | null
  setOpenNode: Dispatch<SetStateAction<string | null>>
  executionResult: ExecutionResult | null
  setExecutionResult: Dispatch<SetStateAction<ExecutionResult | null>>
  isExecuting: boolean
  setIsExecuting: Dispatch<SetStateAction<boolean>>
  inputValues: Record<string, unknown>
  setInputValues: Dispatch<SetStateAction<Record<string, unknown>>>
  lastRunTimestamp: number | null
  setLastRunTimestamp: Dispatch<SetStateAction<number | null>>
  resultStale: boolean
  setResultStale: Dispatch<SetStateAction<boolean>>
  lastError: string | null
  setLastError: Dispatch<SetStateAction<string | null>>
}

const MainContext = createContext<MainContext | undefined>(undefined)

export function Wrapper({ children }: { children: React.ReactNode }) {
  const [model, setModel] = useState<Model>(createDemoModel)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [selectedNodes, setSelectedNodes] = useState<string[]>([])
  const [showChildren, setShowChildren] = useState<Record<string, boolean>>({})
  const [openNode, setOpenNode] = useState<string | null>(null)
  const [executionResult, setExecutionResult] =
    useState<ExecutionResult | null>(null)
  const [isExecuting, setIsExecuting] = useState(false)
  const [inputValues, setInputValues] = useState<Record<string, unknown>>({})
  const [lastRunTimestamp, setLastRunTimestamp] = useState<number | null>(null)
  const [resultStale, setResultStale] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)

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
        openNode,
        setOpenNode,
        executionResult,
        setExecutionResult,
        isExecuting,
        setIsExecuting,
        inputValues,
        setInputValues,
        lastRunTimestamp,
        setLastRunTimestamp,
        resultStale,
        setResultStale,
        lastError,
        setLastError,
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

export function useNodeResult(nodeId: string): NodeResult | undefined {
  const { executionResult } = useMainContext()
  return executionResult?.nodeResults[nodeId]
}

export function useInputValue(nodeName: string): unknown {
  const { inputValues } = useMainContext()
  return inputValues[nodeName]
}
