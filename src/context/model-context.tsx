import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import type { Model, ModelNode, IntegrationTestCase, CustomType } from '@/lib/model'
import type { ExecutionResult, NodeResult } from '@/lib/engine'
import { executeDmn, listCustomTypes } from '@/lib/api/dmn-api'
import { useLocalStorage } from '@/lib/use-local-storage'
import { useDebounce } from '@/lib/use-debounce'
import { buildNameToIdMap, recomputeDependencies } from '@/lib/graph'
import { useSocketEvent } from '@/lib/sockets'
import { deepCopy } from '@/lib/utils'
import { useAppContext } from './app-context'
import type { Socket } from 'socket.io-client'

type ExecutionActions = {
  execute: () => void
  debouncedExecute: () => void
  reset: () => void
}

type RightBarOptions = 'ai' | null

type ModelContextValue = {
  projectId: string
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
  inputValues: Record<string, unknown>
  setInputValues: Dispatch<SetStateAction<Record<string, unknown>>>
  lastRunTimestamp: number | null
  resultStale: boolean
  setResultStale: Dispatch<SetStateAction<boolean>>
  lastError: string | null
  setLastError: Dispatch<SetStateAction<string | null>>
  execution: ExecutionActions
  socket: Socket
  rightBar: RightBarOptions
  setRightBar: Dispatch<SetStateAction<RightBarOptions>>
  customTypes: CustomType[]
  refreshCustomTypes: () => void
}

const ModelContext = createContext<ModelContextValue | undefined>(undefined)

const EMPTY_MODEL: Model = { id: '', name: '', namespace: '', nodes: {} }

export function ModelProvider({
  projectId,
  modelId,
  children,
}: {
  projectId: string
  modelId: string
  children: ReactNode
}) {
  const { socket, updateTabName } = useAppContext()

  const [model, setModel] = useState<Model>(EMPTY_MODEL)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [selectedNodes, setSelectedNodes] = useState<string[]>([])
  const [showChildren, setShowChildren] = useLocalStorage<
    Record<string, boolean>
  >(`showChildren:${modelId}`, {})
  const [openNode, setOpenNode] = useState<string | null>(null)
  const [diffs, setDiffs] = useState<ModelNode[]>([])
  const [executionResult, setExecutionResult] =
    useState<ExecutionResult | null>(null)
  const [isExecuting, setIsExecuting] = useState(false)
  const [inputValues, setInputValues] = useState<Record<string, unknown>>({})
  const [lastRunTimestamp, setLastRunTimestamp] = useState<number | null>(null)
  const [resultStale, setResultStale] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const [rightBar, setRightBar] = useState<RightBarOptions>(null)
  const [customTypes, setCustomTypes] = useState<CustomType[]>([])

  const refreshCustomTypes = useCallback(() => {
    listCustomTypes(projectId)
      .then(setCustomTypes)
      .catch((err) => console.error('Failed to load custom types:', err))
  }, [projectId])

  useEffect(() => {
    refreshCustomTypes()
  }, [refreshCustomTypes])

  // Update custom types when TypeManager mutates them (data passed via event)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (Array.isArray(detail)) {
        setCustomTypes(detail)
      } else {
        refreshCustomTypes()
      }
    }
    window.addEventListener('custom-types-changed', handler)
    return () => window.removeEventListener('custom-types-changed', handler)
  }, [refreshCustomTypes])

  // --- Socket room lifecycle ---
  useEffect(() => {
    socket.emit('join-model', { modelId })

    const handleReconnect = () => {
      socket.emit('join-model', { modelId })
    }
    socket.on('connect', handleReconnect)

    return () => {
      socket.emit('leave-model', { modelId })
      socket.off('connect', handleReconnect)
    }
  }, [socket, modelId])

  // --- Filtered socket event handlers ---
  useSocketEvent(
    socket,
    'model',
    (payload: { modelId: string; data: Model; diffs: ModelNode[] }) => {
      if (payload.modelId !== modelId) return
      setModel(payload.data)
      setDiffs(payload.diffs)
      if (payload.data.name) {
        updateTabName(modelId, payload.data.name)
      }
    }
  )

  useSocketEvent(
    socket,
    'diffs',
    (payload: {
      modelId: string
      data: ModelNode[]
      isDiff: boolean
      resolvedDiffs: string[]
    }) => {
      if (payload.modelId !== modelId) return
      if (payload.isDiff) {
        setDiffs((d) => {
          const newDiffs = deepCopy(d)
          for (const newDiff of payload.data) {
            const existingDiff = newDiffs.find((d) => d.id === newDiff.id)
            if (existingDiff) {
              newDiffs.splice(newDiffs.indexOf(existingDiff), 1, newDiff)
            } else {
              newDiffs.push(newDiff)
            }
          }
          return newDiffs.filter((d) => !payload.resolvedDiffs.includes(d.id))
        })
      } else {
        setModel((m) => {
          const newModel = deepCopy(m)
          for (const diff of payload.data) {
            if (diff.deletedVersion !== undefined) {
              delete newModel.nodes[diff.id]
              continue
            }
            newModel.nodes[diff.id] = diff
          }
          return newModel
        })
      }
    }
  )

  // --- Execution logic ---
  const abortRef = useRef<AbortController | null>(null)
  const debounce = useDebounce(500)
  const modelRef = useRef(model)
  modelRef.current = model
  const inputValuesRef = useRef(inputValues)
  inputValuesRef.current = inputValues

  const execute = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
    }

    const controller = new AbortController()
    abortRef.current = controller

    setIsExecuting(true)
    setLastError(null)

    const currentModel = modelRef.current
    const currentInputValues = inputValuesRef.current

    executeDmn(currentModel, currentInputValues, controller.signal, projectId)
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
        if (abortRef.current === controller) {
          abortRef.current = null
          setIsExecuting(false)
        }
      })
  }, [projectId])

  const debouncedExecute = useCallback(() => {
    debounce(() => execute())
  }, [debounce, execute])

  const reset = useCallback(() => {
    if (abortRef.current) abortRef.current.abort()
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
    const { nodes: updatedDiffs, changed } = recomputeDependencies(
      diffs,
      nameToId
    )
    if (changed) {
      setDiffs(updatedDiffs)
    }
  }, [diffs, model.nodes])

  const execution = useMemo(
    () => ({ execute, debouncedExecute, reset }),
    [execute, debouncedExecute, reset]
  )

  const value: ModelContextValue = {
    projectId,
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
    socket,
    rightBar,
    setRightBar,
    customTypes,
    refreshCustomTypes,
  }

  return (
    <ModelContext.Provider value={value}>{children}</ModelContext.Provider>
  )
}

export function useModelContext(): ModelContextValue {
  const context = useContext(ModelContext)
  if (context === undefined) {
    throw new Error("'useModelContext' must be used within a ModelProvider")
  }
  return context
}

// --- Hooks (unchanged APIs, now read from ModelContext) ---

const SAVE_DEBOUNCE = 1_000

type NodeUpdateConfig = {
  noEmit?: boolean
}

export function useUpdateNode() {
  const { setModel, model, socket } = useModelContext()
  const debounce = useDebounce(SAVE_DEBOUNCE)

  return (
    id: string,
    updater: (node: ModelNode) => ModelNode,
    config?: NodeUpdateConfig
  ) => {
    const updated = updater(model.nodes[id])
    setModel({
      ...model,
      nodes: {
        ...model.nodes,
        [id]: updated,
      },
    })
    if (!config?.noEmit) {
      debounce(() => {
        socket.emit('model-update', {
          modelId: model.id,
          updates: [updated],
          isDiff: false,
        })
      })
    }
  }
}

export function useAddNode() {
  const { setModel, socket, model } = useModelContext()

  return (id: string, node: ModelNode, config?: NodeUpdateConfig) => {
    setModel((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [id]: node,
      },
    }))
    if (!config?.noEmit) {
      socket.emit('model-update', {
        modelId: model.id,
        updates: [node],
        isDiff: false,
      })
    }
  }
}

export function useDeleteNode() {
  const { setModel, model, socket } = useModelContext()

  return (id: string, config?: NodeUpdateConfig) => {
    setModel((prev) => {
      const { [id]: _, ...remaining } = prev.nodes
      const integrationTests = prev.integrationTests?.map((test) => {
        const { [id]: _input, ...restInputs } = test.inputs
        const { [id]: _assertion, ...restAssertions } = test.assertions
        return { ...test, inputs: restInputs, assertions: restAssertions }
      })
      return { ...prev, nodes: remaining, integrationTests }
    })

    if (!config?.noEmit) {
      const node = model.nodes[id]
      socket.emit('model-update', {
        modelId: model.id,
        updates: [{ ...node, deletedVersion: 'TODO' }],
        isDiff: false,
      })
    }
  }
}

export function useNodeResult(nodeId: string): NodeResult | undefined {
  const { executionResult } = useModelContext()
  return executionResult?.nodeResults[nodeId]
}

export function useDiff(nodeId: string) {
  const { diffs } = useModelContext()
  return diffs.find((diff) => diff.id === nodeId)
}

export function useUpdateDiff() {
  const { setDiffs, diffs, socket, model } = useModelContext()
  const debounce = useDebounce(SAVE_DEBOUNCE)

  return (id: string, updater: (diff: ModelNode) => ModelNode) => {
    const diff = diffs.find((d) => d.id === id)
    if (diff === undefined) {
      return
    }
    const updated = updater(diff)
    setDiffs((diffs) =>
      diffs.map((diff) => {
        if (diff.id !== id) {
          return diff
        }
        return updated
      })
    )
    debounce(() => {
      socket.emit('model-update', {
        modelId: model.id,
        updates: [updated],
        isDiff: true,
      })
    })
  }
}

export function useResolveDiff() {
  const { diffs, setDiffs, model, socket } = useModelContext()
  const updateNode = useUpdateNode()
  const addNode = useAddNode()
  const deleteNode = useDeleteNode()

  return (id: string, accept: boolean) => {
    if (accept) {
      const diff = diffs.find((d) => d.id === id)
      if (diff && diff.deletedVersion !== undefined) {
        deleteNode(id, { noEmit: true })
      } else if (diff) {
        const existing = model.nodes[id]
        if (existing) {
          updateNode(
            id,
            (node) => ({
              ...diff,
              description: diff.description ?? node.description,
              links: diff.links ?? node.links,
            }),
            { noEmit: true }
          )
        } else {
          addNode(id, diff, { noEmit: true })
        }
      }
    }

    setDiffs((diffs) => diffs.filter((diff) => diff.id !== id))
    socket.emit('model-update', {
      modelId: model.id,
      updates: [],
      isDiff: true,
      acceptedDiffs: accept ? [id] : [],
      rejectedDiffs: accept ? [] : [id],
    })
  }
}

export function useUpdateIntegrationTests() {
  const { setModel, socket, model } = useModelContext()
  const debounce = useDebounce(SAVE_DEBOUNCE)

  return (
    updater: (tests: IntegrationTestCase[]) => IntegrationTestCase[]
  ) => {
    let updated: IntegrationTestCase[]
    setModel((prev) => {
      updated = updater(prev.integrationTests ?? [])
      return { ...prev, integrationTests: updated }
    })
    debounce(() => {
      socket.emit('integration-tests-update', {
        modelId: model.id,
        integrationTests: updated!,
      })
    })
  }
}

export function useFindNode(nodeId: string | null): ModelNode | undefined {
  const { model, diffs } = useModelContext()

  if (nodeId === null) {
    return undefined
  }

  const modelNode = model.nodes[nodeId]
  if (modelNode !== undefined) {
    return modelNode
  }

  return diffs.find((d) => d.id === nodeId)
}
