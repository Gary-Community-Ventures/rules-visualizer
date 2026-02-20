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
import type { Model, ModelNode, IntegrationTestCase } from './lib/model'
import type { ExecutionResult, NodeResult } from './lib/engine'
import { createKieEngine, getKieBaseUrl } from './lib/engine'
import { createDemoModel } from './lib/demo-data'
import { useLocalStorage } from './lib/use-local-storage'
import { useDebounce } from './lib/use-debounce'
import { buildNameToIdMap, recomputeDependencies } from './lib/graph'
import { useSocket, useSocketEvent } from './lib/sockets'
import { deepCopy } from './lib/utils'
import type { Socket } from 'socket.io-client'

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
  socket: Socket
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
  const debounce = useDebounce(500)
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
      // Use user-entered value, or fall back to default value
      let val = currentInputValues[node.id]
      if (val === undefined || val === '') {
        val = node.content.defaultValue
      }
      // Skip if still empty after fallback
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

  const socket = useSocket()

  useSocketEvent(socket, 'model', ({ data }: { data: Model }) => {
    setModel(data)
  })
  useSocketEvent(
    socket,
    'diffs',
    ({
      data,
      isDiff,
      resolvedDiffs,
    }: {
      data: ModelNode[]
      isDiff: boolean
      resolvedDiffs: string[]
    }) => {
      if (isDiff) {
        setDiffs((d) => {
          const newDiffs = deepCopy(d)
          for (const newDiff of data) {
            const existingDiff = newDiffs.find((d) => d.id === newDiff.id)
            if (existingDiff) {
              newDiffs.splice(newDiffs.indexOf(existingDiff), 1, newDiff)
            } else {
              newDiffs.push(newDiff)
            }
          }

          return newDiffs.filter((d) => !resolvedDiffs.includes(d.id))
        })
      } else {
        setModel((m) => {
          const newModel = deepCopy(m)
          for (const diff of data) {
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
    socket,
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

const SAVE_DEBOUNCE = 1_000

export function useUpdateNode() {
  const { setModel, model, socket } = useMainContext()
  const debounce = useDebounce(SAVE_DEBOUNCE)

  return (id: string, updater: (node: ModelNode) => ModelNode) => {
    const updated = updater(model.nodes[id])
    setModel({
      ...model,
      nodes: {
        ...model.nodes,
        [id]: updated,
      },
    })
    // debounce to avoid sending on every keystroke
    debounce(() => {
      socket.emit('model-update', { updates: [updated], isDiff: false })
    })
  }
}

export function useAddNode() {
  const { setModel, socket } = useMainContext()

  return (id: string, node: ModelNode) => {
    setModel((model) => ({
      ...model,
      nodes: {
        ...model.nodes,
        [id]: node,
      },
    }))
    socket.emit('model-update', { updates: [node], isDiff: false })
  }
}

export function useDeleteNode() {
  const { setModel, model, socket } = useMainContext()

  return (id: string) => {
    setModel((prev) => {
      const { [id]: _, ...remaining } = prev.nodes
      // Clean up stale references in integration tests
      const integrationTests = prev.integrationTests?.map((test) => {
        const { [id]: _input, ...restInputs } = test.inputs
        const { [id]: _assertion, ...restAssertions } = test.assertions
        return { ...test, inputs: restInputs, assertions: restAssertions }
      })
      return { ...prev, nodes: remaining, integrationTests }
    })

    const node = model.nodes[id]
    socket.emit('model-update', {
      updates: [{ ...node, deletedVersion: 'TODO' }], // TODO: use real version
      isDiff: false,
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
  const { setDiffs, diffs, socket } = useMainContext()
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
    // debounce to avoid sending on every keystroke
    debounce(() => {
      socket.emit('model-update', { updates: [updated], isDiff: true })
    })
  }
}

export function useResolveDiff() {
  const { diffs, setDiffs, model, socket } = useMainContext()
  const updateNode = useUpdateNode()
  const addNode = useAddNode()
  const deleteNode = useDeleteNode()

  return (id: string, accept: boolean) => {
    if (accept) {
      const diff = diffs.find((d) => d.id === id)
      if (diff && diff.deletedVersion !== undefined) {
        deleteNode(id)
      } else if (diff) {
        const existing = model.nodes[id]
        if (existing) {
          // Preserve existing tests when the diff doesn't include them
          updateNode(id, (node) => ({
            ...diff,
            tests: diff.tests ?? node.tests,
          }))
        } else {
          // New node from diff — add it directly
          addNode(id, diff)
        }
      }
    }

    setDiffs((diffs) => diffs.filter((diff) => diff.id !== id))
    socket.emit('model-update', {
      updates: [],
      isDiff: true,
      resolvedDiffs: [id],
    })
  }
}

export function useUpdateIntegrationTests() {
  const { setModel, socket } = useMainContext()
  const debounce = useDebounce(SAVE_DEBOUNCE)

  return (updater: (tests: IntegrationTestCase[]) => IntegrationTestCase[]) => {
    let updated: IntegrationTestCase[]
    setModel((prev) => {
      updated = updater(prev.integrationTests ?? [])
      return { ...prev, integrationTests: updated }
    })
    debounce(() => {
      socket.emit('integration-tests-update', { integrationTests: updated! })
    })
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
