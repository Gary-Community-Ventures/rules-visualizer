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
  getRulesetInputs,
  executeRuleset,
  type ExecutionResults,
  type RulesetInputs,
} from '@/lib/api/rules-api'
import { onReload } from '@/lib/api/live-reload'
import { useLocalStorage } from '@/lib/use-local-storage'
import { useAppContext } from './app-context'

export type RightBarOptions = 'ai' | 'execution' | null

/** Check if a node is an "input" that users can provide values for */
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
  if (content.format === 'rac' && content.type === 'variable') return content.path
  if (content.format === 'factGraph') return content.path
  return undefined
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
  setOpenNode: Dispatch<SetStateAction<string | null>>
  rightBar: RightBarOptions
  setRightBar: Dispatch<SetStateAction<RightBarOptions>>
  // Execution
  rulesetInputs: RulesetInputs | null
  inputOverrides: Record<string, string>
  setInputOverride: (nodeId: string, value: string) => void
  clearInputOverride: (nodeId: string) => void
  entityTables: Record<string, Record<string, string>[]>
  setEntityTables: Dispatch<SetStateAction<Record<string, Record<string, string>[]>>>
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

/** Convert string entity table values to typed values */
function parseEntityTables(
  tables: Record<string, Record<string, string>[]>
): Record<string, Record<string, unknown>[]> {
  const result: Record<string, Record<string, unknown>[]> = {}
  for (const [entity, rows] of Object.entries(tables)) {
    if (rows.length === 0) continue
    result[entity] = rows.map((row) => {
      const parsed: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(row)) {
        if (val === '') continue
        try {
          parsed[key] = JSON.parse(val)
        } catch {
          parsed[key] = val
        }
      }
      return parsed
    })
  }
  return result
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
  const [openNode, setOpenNode] = useState<string | null>(null)
  const [rightBar, setRightBar] = useState<RightBarOptions>(null)

  // Execution state
  const [rulesetInputs, setRulesetInputs] = useState<RulesetInputs | null>(null)
  const [inputOverrides, setInputOverrides] = useState<Record<string, string>>({})
  const [entityTables, setEntityTables] = useState<
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

  const runExecution = useCallback(() => {
    setIsExecuting(true)
    setExecutionError(null)
    const inputs = parseOverrides(inputOverrides, model.nodes)
    const entities = parseEntityTables(entityTables)
    executeRuleset(rulesetId, inputs, entities)
      .then((results) => setExecutionResults(results))
      .catch((err) => {
        const message =
          err instanceof Error ? err.message : 'Execution failed'
        setExecutionError(message)
      })
      .finally(() => setIsExecuting(false))
  }, [rulesetId, inputOverrides, entityTables, model.nodes])

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

    // Also fetch input metadata
    getRulesetInputs(rulesetId)
      .then(setRulesetInputs)
      .catch(() => setRulesetInputs(null))
  }, [rulesetId, updateTabName])

  // Load model from API
  useEffect(() => {
    loadModel()
  }, [loadModel])

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
      rightBar,
      setRightBar,
      rulesetInputs,
      inputOverrides,
      setInputOverride,
      clearInputOverride,
      entityTables,
      setEntityTables,
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
      rightBar,
      setRightBar,
      rulesetInputs,
      inputOverrides,
      setInputOverride,
      clearInputOverride,
      entityTables,
      setEntityTables,
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
