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

/** Check if a node can be overridden during execution */
export function isOverridable(node: ModelNode): boolean {
  return node.overridable
}

/** Get a short type hint for a node's value (e.g. "USD", "Boolean", "Integer") */
export function getTypeHint(node: ModelNode): string | undefined {
  const c = node.content
  if (c.type === 'entity') return undefined

  if (c.format === 'factGraph') {
    const typeName = c.type === 'writable' ? c.typeName : c.dataType
    switch (typeName) {
      case 'Dollar':
        return 'USD'
      case 'Int':
      case 'Short':
      case 'Byte':
        return 'Integer'
      case 'Boolean':
        return 'Boolean'
      case 'String':
        return 'Text'
      case 'Day':
        return 'Date'
      case 'Rational':
        return 'Rate'
      case 'Enum':
        return 'Enum'
    }
    return typeName
  }

  if (c.format === 'rac' && c.type === 'variable') {
    if (c.unit === 'USD') return 'USD'
    if (c.unit === 'rate') return 'Rate'
    // Infer from default value
    if (c.default === 'true' || c.default === 'false') return 'Boolean'
    if (c.default && /^\d+$/.test(c.default)) return 'Integer'
    if (c.default && /^\d+\.\d+$/.test(c.default)) return 'Number'
    if (c.unit) return c.unit
  }

  return undefined
}

/** Get the collection name for a node, or null if not collection-scoped */
export function getCollectionInfo(node: ModelNode): { collection: string } | null {
  const c = node.content
  if (c.type === 'entity') return null

  // RAC: check entity field
  if (c.format === 'rac' && c.type === 'variable' && c.entity) {
    return { collection: c.entity }
  }

  // Fact Graph: check for /* in path (collection items)
  if (c.format === 'factGraph') {
    const match = c.path.match(/^(\/[^*]+)\/\*\//)
    if (match) return { collection: match[1] }
  }

  return null
}

/** Check if a node is a Collection parent (Fact Graph only, e.g. /members with <Collection />) */
export function isCollectionParent(node: ModelNode): boolean {
  const c = node.content
  return c.format === 'factGraph' && c.type === 'writable' && c.typeName === 'Collection'
}

/** Get collection input fields grouped by collection name (works for both formats) */
export function getCollectionInputs(
  nodes: Record<string, ModelNode>
): Record<string, { nodeId: string; path: string; fieldName: string; default?: string; typeHint?: string }[]> {
  const result: Record<string, { nodeId: string; path: string; fieldName: string; default?: string; typeHint?: string }[]> = {}
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (!isInputNode(node)) continue
    if (isCollectionParent(node)) continue
    const info = getCollectionInfo(node)
    if (!info) continue
    if (!result[info.collection]) result[info.collection] = []

    // Extract the field name (last path segment for FG, variable name for RAC)
    const c = node.content
    let fieldName = node.name
    let fieldPath = c.type !== 'entity' ? c.path : ''
    let defaultVal: string | undefined
    if (c.format === 'rac' && c.type === 'variable') {
      defaultVal = c.default
      fieldPath = c.path
    } else if (c.format === 'factGraph') {
      // For /members/*/age, the field path for entity data is just "age"
      const segments = c.path.split('/')
      fieldPath = segments[segments.length - 1]
    }

    result[info.collection].push({
      nodeId,
      path: fieldPath,
      fieldName,
      default: defaultVal,
      typeHint: getTypeHint(node),
    })
  }
  return result
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
  clearOverrides: () => void
  clearAll: () => void
  entityData: Record<string, Record<string, string>[]>
  setEntityData: Dispatch<SetStateAction<Record<string, Record<string, string>[]>>>
  executionResults: ExecutionResults | null
  isExecuting: boolean
  executionError: string | null
  runExecution: () => void
  runOnBlur: () => void
  clearExecution: () => void
  workspaceItems: string[]
  setWorkspaceItems: Dispatch<SetStateAction<string[]>>
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

  const [panelOpen, setPanelOpen] = useState(false)

  const openNode =
    panelOpen && nodeHistoryIndex >= 0 ? nodeHistory[nodeHistoryIndex] : null

  const setOpenNode = useCallback(
    (nodeId: string | null) => {
      if (nodeId === null) {
        setPanelOpen(false)
      } else {
        setPanelOpen(true)
        if (
          nodeId !==
          (nodeHistoryIndex >= 0 ? nodeHistory[nodeHistoryIndex] : null)
        ) {
          setNodeHistory((prev) => [
            ...prev.slice(0, nodeHistoryIndex + 1),
            nodeId,
          ])
          setNodeHistoryIndex((prev) => prev + 1)
        }
      }
    },
    [nodeHistory, nodeHistoryIndex]
  )

  const goBackNode = useCallback(() => {
    if (!panelOpen && nodeHistoryIndex >= 0) {
      setPanelOpen(true)
    } else if (nodeHistoryIndex > 0) {
      setNodeHistoryIndex((i) => i - 1)
      setPanelOpen(true)
    }
  }, [nodeHistoryIndex, panelOpen])

  const goForwardNode = useCallback(() => {
    if (nodeHistoryIndex < nodeHistory.length - 1) {
      setNodeHistoryIndex((i) => i + 1)
      setPanelOpen(true)
    }
  }, [nodeHistoryIndex, nodeHistory.length])

  const goToHistoryIndex = useCallback(
    (index: number) => {
      if (index >= 0 && index < nodeHistory.length) {
        setNodeHistoryIndex(index)
        setPanelOpen(true)
      }
    },
    [nodeHistory.length]
  )

  const [rightBar, setRightBar] = useState<RightBarOptions>(null)
  const [logicYear, setLogicYear] = useState<number>(new Date().getFullYear())

  // Execution state
  const [inputOverrides, setInputOverrides] = useState<Record<string, string>>(
    {}
  )
  const [entityData, setEntityData] = useState<
    Record<string, Record<string, string>[]>
  >({})
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

  // Clear only override values (constants + computed), keep input values
  const clearOverrides = useCallback(() => {
    setInputOverrides((prev) => {
      const next: Record<string, string> = {}
      for (const [nodeId, value] of Object.entries(prev)) {
        const node = model.nodes[nodeId]
        if (node && isInputNode(node)) {
          next[nodeId] = value
        }
      }
      return next
    })
    setExecutionResults(null)
    setExecutionError(null)
  }, [model.nodes])

  // Clear everything — inputs, overrides, entity data, results
  const clearAll = useCallback(() => {
    setInputOverrides({})
    setEntityData({})
    setExecutionResults(null)
    setExecutionError(null)
  }, [])

  const runExecution = useCallback(() => {
    setIsExecuting(true)
    setExecutionError(null)
    const inputs = parseOverrides(inputOverrides, model.nodes)
    // Parse entity data: convert string values to typed
    const entities: Record<string, Record<string, unknown>[]> | undefined =
      Object.keys(entityData).length > 0
        ? Object.fromEntries(
            Object.entries(entityData).map(([entity, rows]) => [
              entity,
              rows.map((row, i) => {
                const parsed: Record<string, unknown> = { id: i + 1 }
                for (const [key, val] of Object.entries(row)) {
                  if (val === '') continue
                  try { parsed[key] = JSON.parse(val) } catch { parsed[key] = val }
                }
                return parsed
              }),
            ])
          )
        : undefined
    executeRuleset(rulesetId, inputs, entities)
      .then((results) => setExecutionResults(results))
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Execution failed'
        setExecutionError(message)
      })
      .finally(() => setIsExecuting(false))
  }, [rulesetId, inputOverrides, entityData, model.nodes])

  const clearExecution = useCallback(() => {
    setExecutionResults(null)
    setExecutionError(null)
  }, [])

  // Auto-run execution when an input field loses focus
  const runOnBlur = useCallback(() => {
    const hasAnyInput = Object.values(inputOverrides).some((v) => v !== '')
    const hasEntityData = Object.values(entityData).some((rows) => rows.length > 0)
    if (hasAnyInput || hasEntityData) runExecution()
  }, [inputOverrides, entityData, runExecution])

  const [workspaceItems, setWorkspaceItems] = useLocalStorage<string[]>(
    `workspace:${rulesetId}`,
    []
  )

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
      clearOverrides,
      clearAll,
      entityData,
      setEntityData,
      executionResults,
      isExecuting,
      executionError,
      runExecution,
      runOnBlur,
      clearExecution,
      workspaceItems,
      setWorkspaceItems,
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
      clearOverrides,
      clearAll,
      entityData,
      setEntityData,
      executionResults,
      isExecuting,
      executionError,
      runExecution,
      runOnBlur,
      clearExecution,
      workspaceItems,
      setWorkspaceItems,
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
