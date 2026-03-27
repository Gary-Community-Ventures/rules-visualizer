import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import type { Model, ModelNode, NodeContent } from '@/lib/model'
import {
  getRuleset,
  executeRuleset,
  type ExecutionResults,
} from '@/lib/api/rules-api'
import { onReload } from '@/lib/api/live-reload'
import { useLocalStorage } from '@/lib/use-local-storage'
import { useAppContext } from './app-context'

export type RightBarOptions = 'ai' | 'execution' | null

/** Check if a node is an "input" that users must provide values for */
export function isInputNode(node: ModelNode): boolean {
  if (node.content.type === 'entity') return false
  return node.content.role === 'input'
}

/** Check if a node is a constant (overridable for simulation) */
export function isConstantNode(node: ModelNode): boolean {
  if (node.content.type === 'entity') return false
  return node.content.role === 'constant'
}

/** Get the variable path for a node (used as the key in execution inputs) */
export function getNodePath(content: NodeContent): string | undefined {
  if (content.type === 'entity') return undefined
  return content.path
}

type ModelContextValue = {
  model: Model
  isLoading: boolean
  error: string | null
  hoveredNodeId: string | null
  setHoveredNodeId: Dispatch<SetStateAction<string | null>>
  selectedNodes: string[]
  setSelectedNodes: Dispatch<SetStateAction<string[]>>
  showChildren: Record<string, boolean>
  setShowChildren: Dispatch<SetStateAction<Record<string, boolean>>>
  openNode: string | null
  setOpenNode: (nodeId: string | null) => void
  nodeHistory: string[]
  nodeHistoryIndex: number
  goBackNode: () => void
  goForwardNode: () => void
  goToHistoryIndex: (index: number) => void
  rightBar: RightBarOptions
  setRightBar: Dispatch<SetStateAction<RightBarOptions>>
  logicYear: number
  setLogicYear: Dispatch<SetStateAction<number>>
  // Execution
  inputOverrides: Record<string, string>
  setInputOverride: (nodeId: string, value: string) => void
  clearInputOverride: (nodeId: string) => void
  executionResults: ExecutionResults | null
  isExecuting: boolean
  executionError: string | null
  runExecution: () => void
  clearExecution: () => void
}

const ModelContext = createContext<ModelContextValue | undefined>(undefined)

const EMPTY_MODEL: Model = {
  id: '',
  name: '',
  format: 'rac',
  nodes: {},
}

/** Convert string input overrides to typed values for the execution API */
function parseOverrides(
  overrides: Record<string, string>,
  nodes: Record<string, ModelNode>
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {}
  for (const [nodeId, rawValue] of Object.entries(overrides)) {
    if (rawValue === '') continue
    const node = nodes[nodeId]
    if (!node) continue
    const path = getNodePath(node.content)
    if (!path) continue
    try {
      inputs[path] = JSON.parse(rawValue)
    } catch {
      inputs[path] = rawValue
    }
  }
  return inputs
}

export function ModelProvider({
  rulesetId,
  children,
}: {
  rulesetId: string
  children: ReactNode
}) {
  const { updateTabName } = useAppContext()

  const [model, setModel] = useState<Model>(EMPTY_MODEL)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [selectedNodes, setSelectedNodes] = useState<string[]>([])
  const [showChildren, setShowChildren] = useLocalStorage<
    Record<string, boolean>
  >(`showChildren:${rulesetId}`, {})
  const [nodeHistory, setNodeHistory] = useState<string[]>([])
  const [nodeHistoryIndex, setNodeHistoryIndex] = useState(-1)

  const openNode = nodeHistoryIndex >= 0 ? nodeHistory[nodeHistoryIndex] : null

  const setOpenNode = useCallback((nodeId: string | null) => {
    if (nodeId === null) {
      // Close panel but keep history
      setNodeHistoryIndex(-1)
    } else if (nodeId !== (nodeHistoryIndex >= 0 ? nodeHistory[nodeHistoryIndex] : null)) {
      // Truncate forward history and push new entry
      setNodeHistory((prev) => [...prev.slice(0, nodeHistoryIndex + 1), nodeId])
      setNodeHistoryIndex((prev) => prev + 1)
    }
  }, [nodeHistory, nodeHistoryIndex])

  const goBackNode = useCallback(() => {
    if (nodeHistoryIndex > 0) {
      setNodeHistoryIndex((i) => i - 1)
    }
  }, [nodeHistoryIndex])

  const goForwardNode = useCallback(() => {
    if (nodeHistoryIndex < nodeHistory.length - 1) {
      setNodeHistoryIndex((i) => i + 1)
    }
  }, [nodeHistoryIndex, nodeHistory.length])

  const goToHistoryIndex = useCallback((index: number) => {
    if (index >= 0 && index < nodeHistory.length) {
      setNodeHistoryIndex(index)
    }
  }, [nodeHistory.length])

  const [rightBar, setRightBar] = useState<RightBarOptions>(null)
  const [logicYear, setLogicYear] = useState<number>(new Date().getFullYear())

  // Execution state
  const [inputOverrides, setInputOverrides] = useState<Record<string, string>>({})
  const [executionResults, setExecutionResults] =
    useState<ExecutionResults | null>(null)
  const [isExecuting, setIsExecuting] = useState(false)
  const [executionError, setExecutionError] = useState<string | null>(null)

  const setInputOverride = useCallback((nodeId: string, value: string) => {
    setInputOverrides((prev) => ({ ...prev, [nodeId]: value }))
  }, [])

  const clearInputOverride = useCallback((nodeId: string) => {
    setInputOverrides((prev) => {
      const next = { ...prev }
      delete next[nodeId]
      return next
    })
  }, [])

  const runExecution = useCallback(() => {
    setIsExecuting(true)
    setExecutionError(null)
    const inputs = parseOverrides(inputOverrides, model.nodes)
    executeRuleset(rulesetId, inputs)
      .then((results) => setExecutionResults(results))
      .catch((err) => {
        const message =
          err instanceof Error ? err.message : 'Execution failed'
        setExecutionError(message)
      })
      .finally(() => setIsExecuting(false))
  }, [rulesetId, inputOverrides, model.nodes])

  const clearExecution = useCallback(() => {
    setExecutionResults(null)
    setExecutionError(null)
  }, [])

  const loadModel = useCallback(() => {
    setIsLoading(true)
    setError(null)

    getRuleset(rulesetId)
      .then((data) => {
        setModel(data)
        if (data.name) {
          updateTabName(rulesetId, data.name)
        }
      })
      .catch((err) => {
        const message =
          err instanceof Error ? err.message : 'Failed to load ruleset'
        setError(message)
        console.error('Failed to load ruleset:', err)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [rulesetId, updateTabName])

  // Load model from API
  useEffect(() => {
    loadModel()
  }, [loadModel])

  // Set favicon based on format
  useEffect(() => {
    const href = model.format === 'rac' ? '/favicon-rac.svg' : '/favicon-fg.svg'
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']")
    if (link) {
      link.href = href
    } else {
      link = document.createElement('link')
      link.rel = 'icon'
      link.type = 'image/svg+xml'
      link.href = href
      document.head.appendChild(link)
    }
  }, [model.format])

  // Live reload: re-fetch when backend notifies of file changes
  useEffect(() => {
    return onReload((changedRulesetId) => {
      if (!changedRulesetId || changedRulesetId === rulesetId) {
        loadModel()
      }
    })
  }, [rulesetId, loadModel])

  const value: ModelContextValue = useMemo(
    () => ({
      model,
      isLoading,
      error,
      hoveredNodeId,
      setHoveredNodeId,
      selectedNodes,
      setSelectedNodes,
      showChildren,
      setShowChildren,
      openNode,
      setOpenNode,
      nodeHistory,
      nodeHistoryIndex,
      goBackNode,
      goForwardNode,
      goToHistoryIndex,
      rightBar,
      setRightBar,
      logicYear,
      setLogicYear,
      inputOverrides,
      setInputOverride,
      clearInputOverride,
      executionResults,
      isExecuting,
      executionError,
      runExecution,
      clearExecution,
    }),
    [
      model,
      isLoading,
      error,
      hoveredNodeId,
      setHoveredNodeId,
      selectedNodes,
      setSelectedNodes,
      showChildren,
      setShowChildren,
      openNode,
      setOpenNode,
      nodeHistory,
      nodeHistoryIndex,
      goBackNode,
      goForwardNode,
      goToHistoryIndex,
      rightBar,
      setRightBar,
      logicYear,
      setLogicYear,
      inputOverrides,
      setInputOverride,
      clearInputOverride,
      executionResults,
      isExecuting,
      executionError,
      runExecution,
      clearExecution,
    ]
  )

  return <ModelContext.Provider value={value}>{children}</ModelContext.Provider>
}

export function useModelContext(): ModelContextValue {
  const context = useContext(ModelContext)
  if (context === undefined) {
    throw new Error("'useModelContext' must be used within a ModelProvider")
  }
  return context
}

export function useFindNode(nodeId: string | null): ModelNode | undefined {
  const { model } = useModelContext()

  if (nodeId === null) {
    return undefined
  }

  return model.nodes[nodeId]
}
