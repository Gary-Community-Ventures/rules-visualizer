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
import { useLocalStorage } from './lib/use-local-storage'
import { buildNameToIdMap, recomputeDependencies } from './lib/graph'

type ExecutionActions = {
  execute: () => void
  debouncedExecute: () => void
  reset: () => void
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
  diffs: ModelNode[]
  setDiffs: Dispatch<SetStateAction<ModelNode[]>>
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
  const { model: demoModel, diffs: demoDiffs } = createDemoModel()

  const [model, setModel] = useState<Model>(demoModel)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [selectedNodes, setSelectedNodes] = useState<string[]>([])
  const [showChildren, setShowChildren] = useLocalStorage<
    Record<string, boolean>
  >('showChildren', {})
  const [openNode, setOpenNode] = useState<string | null>(null)
  const [diffs, setDiffs] = useState<ModelNode[]>(demoDiffs)
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
      if (node.content.type !== 'input') continue
      const val = currentInputValues[node.id]
      // Skip undefined and empty strings (cleared inputs)
      if (val === undefined || val === '') continue
      if (node.name in nameInputs) {
        console.warn(
          `Duplicate input node name "${node.name}" — only the last value will be sent to KIE`
        )
      }
      nameInputs[node.name] = val
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
        // Only reset state if this controller is still the active one.
        // If a newer execute() replaced us, it owns isExecuting now.
        if (abortRef.current === controller) {
          abortRef.current = null
          setIsExecuting(false)
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

  const reset = useCallback(() => {
    if (abortRef.current) abortRef.current.abort()
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setExecutionResult(null)
    setIsExecuting(false)
    setInputValues({})
    setLastRunTimestamp(null)
    setResultStale(false)
    setLastError(null)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  // Auto-recompute node dependencies from FEEL expression content
  useEffect(() => {
    const nameToId = buildNameToIdMap(model.nodes)
    const { nodes, changed } = recomputeDependencies(
      Object.values(model.nodes),
      nameToId
    )
    if (changed) {
      const updatedNodes: Record<string, (typeof nodes)[number]> = {}
      for (const node of nodes) {
        updatedNodes[node.id] = node
      }
      setModel((m) => ({ ...m, nodes: updatedNodes }))
    }
  }, [model])

  // Auto-recompute diff dependencies from FEEL expression content
  useEffect(() => {
    const nameToId = buildNameToIdMap(model.nodes, diffs)
    const { nodes: updatedDiffs, changed } = recomputeDependencies(diffs, nameToId)
    if (changed) {
      setDiffs(updatedDiffs)
    }
  }, [diffs, model.nodes])

  const execution = useMemo(
    () => ({ execute, debouncedExecute, reset }),
    [execute, debouncedExecute, reset]
  )

  const value = {
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
    diffs,
    setDiffs,
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
  }
  return <MainContext.Provider value={value}>{children}</MainContext.Provider>
}

export function useMainContext(): MainContext {
  const context = useContext(MainContext)

  if (context === undefined) {
    throw new Error("'useMainContext' must be used within the Wrapper")
  }

  return context
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

export function useDeleteNode() {
  const { setModel } = useMainContext()

  return (id: string) => {
    setModel((model) => {
      const { [id]: _, ...remaining } = model.nodes
      return { ...model, nodes: remaining }
    })
  }
}

export function useNodeResult(nodeId: string): NodeResult | undefined {
  const { executionResult } = useMainContext()
  return executionResult?.nodeResults[nodeId]
}

export function useDiff(nodeId: string) {
  const { diffs } = useMainContext()

  return diffs.find((diff) => diff.id === nodeId)
}

export function useUpdateDiff() {
  const { setDiffs } = useMainContext()

  return (id: string, updater: (diff: ModelNode) => ModelNode) => {
    setDiffs((diffs) =>
      diffs.map((diff) => {
        if (diff.id !== id) {
          return diff
        }

        return updater(diff)
      })
    )
  }
}

export function useResolveDiff() {
  const { diffs, setDiffs } = useMainContext()
  const updateNode = useUpdateNode()
  const deleteNode = useDeleteNode()

  return (id: string, accept: boolean) => {
    if (accept) {
      const diff = diffs.find((d) => d.id === id)
      if (diff && diff.deletedVersion !== undefined) {
        deleteNode(id)
      } else if (diff) {
        updateNode(id, () => diff)
      }
    }

    setDiffs((diffs) => diffs.filter((diff) => diff.id !== id))
  }
}

export function useFindNode(nodeId: string | null): ModelNode | undefined {
  const { model, diffs } = useMainContext()

  if (nodeId === null) {
    return undefined
  }

  const modelNode = model.nodes[nodeId]
  if (modelNode !== undefined) {
    return modelNode
  }

  return diffs.find((d) => d.id === nodeId)
}
