import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { Model, ModelNode } from './lib/model'
import type { ExecutionResult, NodeResult } from './lib/engine'
import { createKieEngine, getKieBaseUrl } from './lib/engine'
import { createDemoModel } from './lib/demo-data'

type ExecutionActions = {
  execute: () => void
  debouncedExecute: () => void
}

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
  isExecuting: boolean
  inputValues: Record<string, unknown> // keyed by node ID
  setInputValues: Dispatch<SetStateAction<Record<string, unknown>>>
  lastRunTimestamp: number | null
  resultStale: boolean
  setResultStale: Dispatch<SetStateAction<boolean>>
  lastError: string | null
  setLastError: Dispatch<SetStateAction<string | null>>
  execution: ExecutionActions
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

  // Single shared refs for execution
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Use refs for latest values so execute closure doesn't go stale
  const modelRef = useRef(model)
  modelRef.current = model
  const inputValuesRef = useRef(inputValues)
  inputValuesRef.current = inputValues

  const execute = useCallback(() => {
    // Guard against concurrent executions
    if (abortRef.current) {
      abortRef.current.abort()
    }

    const controller = new AbortController()
    abortRef.current = controller

    setIsExecuting(true)
    setLastError(null)

    // Build name-keyed inputs from ID-keyed inputValues for KIE
    const currentModel = modelRef.current
    const currentInputValues = inputValuesRef.current
    const nameInputs: Record<string, unknown> = {}
    for (const node of Object.values(currentModel.nodes)) {
      if (
        node.content.type === 'input' &&
        currentInputValues[node.id] !== undefined
      ) {
        nameInputs[node.name] = currentInputValues[node.id]
      }
    }

    const baseUrl = getKieBaseUrl()
    const engine = createKieEngine(baseUrl)

    engine
      .execute(currentModel, nameInputs, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setExecutionResult(result)
        setLastRunTimestamp(Date.now())
        setResultStale(false)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        const message =
          err instanceof Error ? err.message : 'Unknown execution error'
        setLastError(message)
        console.error('Execution failed:', err)
      })
      .finally(() => {
        if (controller.signal.aborted) return
        setIsExecuting(false)
        if (abortRef.current === controller) {
          abortRef.current = null
        }
      })
  }, [])

  const debouncedExecute = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }
    debounceRef.current = setTimeout(() => {
      execute()
    }, 500)
  }, [execute])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  const execution = useMemo(
    () => ({ execute, debouncedExecute }),
    [execute, debouncedExecute]
  )

  const value = useMemo(
    () => ({
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
      isExecuting,
      inputValues,
      setInputValues,
      lastRunTimestamp,
      resultStale,
      setResultStale,
      lastError,
      setLastError,
      execution,
    }),
    [
      model,
      hoveredNodeId,
      selectedNodes,
      showChildren,
      openNode,
      executionResult,
      isExecuting,
      inputValues,
      lastRunTimestamp,
      resultStale,
      lastError,
      execution,
    ]
  )

  return <MainContext.Provider value={value}>{children}</MainContext.Provider>
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
