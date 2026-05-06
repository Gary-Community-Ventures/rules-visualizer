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
import { getRuleset, type ExecutionResults } from '@/lib/api/rules-api'
import { onReload } from '@/lib/api/live-reload'
import { useLocalStorage } from '@/lib/use-local-storage'
import { consumePendingScenario } from '@/lib/simulation-bridge'
import { useAppContext } from './app-context'

export type RightBarOptions =
  | 'ai'
  | 'execution'
  | 'tests'
  | 'policy'
  | 'tasks'
  | 'profiles'
  | null

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

/** Static enum options for this node, if it's an Enum (writable OR derived)
 *  whose target EnumOptions fact was resolvable. Used to render an enum
 *  dropdown both for inputs and for overrides on derived enum nodes. */
export function getNodeEnumOptions(node: ModelNode): string[] | undefined {
  const c = node.content
  if (c.type === 'entity') return undefined
  if (c.format === 'factGraph') {
    if (c.type === 'writable') return c.enumOptions
    if (c.type === 'derived') return c.enumOptions
  }
  return undefined
}

/** Raw fact-graph type name for this node, if available. Used to pick the
 *  right typed input (Boolean → select, Day → date picker, etc.). */
export function getNodeTypeName(node: ModelNode): string | undefined {
  const c = node.content
  if (c.type === 'entity') return undefined
  if (c.format === 'factGraph') {
    return c.type === 'writable' ? c.typeName : c.dataType
  }
  if (c.format === 'rac' && c.type === 'variable') {
    if (c.unit === 'USD') return 'Dollar'
    if (c.default === 'true' || c.default === 'false') return 'Boolean'
    if (c.default && /^\d+$/.test(c.default)) return 'Int'
    if (c.default && /^\d+\.\d+$/.test(c.default)) return 'Dollar'
  }
  return undefined
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
export function getCollectionInfo(
  node: ModelNode
): { collection: string } | null {
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
  return (
    c.format === 'factGraph' &&
    c.type === 'writable' &&
    c.typeName === 'Collection'
  )
}

type CollectionField = {
  nodeId: string
  path: string
  fieldName: string
  default?: string
  typeHint?: string
  typeName?: string
  enumOptions?: string[]
  /** True when the field backs a derived/constant node — writing to it acts
   *  as a per-member override rather than a primary input. */
  isOverride?: boolean
}

function collectCollectionFields(
  nodes: Record<string, ModelNode>,
  accept: (node: ModelNode) => boolean
): Record<string, CollectionField[]> {
  const result: Record<string, CollectionField[]> = {}
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (!accept(node)) continue
    if (isCollectionParent(node)) continue
    const info = getCollectionInfo(node)
    if (!info) continue
    if (!result[info.collection]) result[info.collection] = []

    const c = node.content
    const fieldPath = getCollectionFieldKey(node) ?? ''
    const defaultVal =
      c.type !== 'entity' && c.format === 'rac' && c.type === 'variable'
        ? c.default
        : undefined

    result[info.collection].push({
      nodeId,
      path: fieldPath,
      fieldName: node.name,
      default: defaultVal,
      typeHint: getTypeHint(node),
      typeName: getNodeTypeName(node),
      enumOptions: getNodeEnumOptions(node),
      isOverride: !isInputNode(node),
    })
  }
  return result
}

/** Collection input fields, keyed by collection name. Only writable inputs. */
export function getCollectionInputs(
  nodes: Record<string, ModelNode>
): Record<string, CollectionField[]> {
  return collectCollectionFields(nodes, isInputNode)
}

/** Every per-member field the user can set a value for — inputs plus
 *  overridable derived/constant fields. Used by the in-graph collection
 *  editor, which treats derived entries as per-member overrides. */
export function getCollectionOverridableFields(
  nodes: Record<string, ModelNode>
): Record<string, CollectionField[]> {
  return collectCollectionFields(
    nodes,
    (node) => isInputNode(node) || isOverridable(node)
  )
}

/** The key used for this node's value in an entityData row — always the
 *  node's full path. Returns undefined for entity nodes. */
export function getCollectionFieldKey(node: ModelNode): string | undefined {
  const c = node.content
  if (c.type === 'entity') return undefined
  return c.path
}

/** Human-readable collection name (e.g. "/members" → "members"). */
export function getCollectionDisplayName(collection: string): string {
  return collection.startsWith('/') ? collection.slice(1) : collection
}

/** Get the variable path for a node (used as the key in execution inputs) */
export function getNodePath(content: NodeContent): string | undefined {
  if (content.type === 'entity') return undefined
  return content.path
}

type ModelContextValue = {
  rulesetId: string
  model: Model
  isLoading: boolean
  error: string | null
  hoveredNodeId: string | null
  setHoveredNodeId: Dispatch<SetStateAction<string | null>>
  selectedNodes: string[]
  setSelectedNodes: Dispatch<SetStateAction<string[]>>
  showChildren: Record<string, boolean>
  setShowChildren: Dispatch<SetStateAction<Record<string, boolean>>>
  // Node navigation — derived `openNode` (panel-aware) plus raw history
  // state. The setOpenNode / goBack / goForward orchestrators live in
  // lib/use-node-navigation.ts.
  openNode: string | null
  nodeHistory: string[]
  setNodeHistory: Dispatch<SetStateAction<string[]>>
  nodeHistoryIndex: number
  setNodeHistoryIndex: Dispatch<SetStateAction<number>>
  panelOpen: boolean
  setPanelOpen: Dispatch<SetStateAction<boolean>>
  rightBar: RightBarOptions
  setRightBar: Dispatch<SetStateAction<RightBarOptions>>
  logicYear: number
  setLogicYear: Dispatch<SetStateAction<number>>
  asOfDate: string
  setAsOfDate: Dispatch<SetStateAction<string>>
  // Execution — raw state + setters; action helpers (setInputOverride,
  // clearOverrides, clearAll, etc.) live in lib/use-input-actions.ts as
  // hooks rather than being colocated here, so the context stays a thin
  // get/set surface.
  inputOverrides: Record<string, string>
  setInputOverrides: Dispatch<SetStateAction<Record<string, string>>>
  entityData: Record<string, Record<string, string>[]>
  setEntityData: Dispatch<
    SetStateAction<Record<string, Record<string, string>[]>>
  >
  executionResults: ExecutionResults | null
  setExecutionResults: Dispatch<SetStateAction<ExecutionResults | null>>
  isExecuting: boolean
  setIsExecuting: Dispatch<SetStateAction<boolean>>
  executionError: string | null
  setExecutionError: Dispatch<SetStateAction<string | null>>
  workspaceItems: string[]
  setWorkspaceItems: Dispatch<SetStateAction<string[]>>
  // Active test state displayed on graph nodes
  activeTest: {
    expectations: Record<
      string,
      { expected: unknown; actual: unknown; passed: boolean }
    >
    inputs: Record<string, unknown>
    computedValues: Record<string, unknown>
  } | null
  setActiveTest: Dispatch<
    SetStateAction<{
      expectations: Record<
        string,
        { expected: unknown; actual: unknown; passed: boolean }
      >
      inputs: Record<string, unknown>
      computedValues: Record<string, unknown>
    } | null>
  >
  refreshModel: () => void
  // Policy navigation — raw state + setters; the openPolicyAtPage /
  // openPolicyForLinking orchestrators live in lib/use-policy-navigation.ts.
  policyTargetPage: number | null
  setPolicyTargetPage: Dispatch<SetStateAction<number | null>>
  policyFocusSectionIds: string[] | null
  setPolicyFocusSectionIds: Dispatch<SetStateAction<string[] | null>>
  policyTargetDocId: string | null
  setPolicyTargetDocId: Dispatch<SetStateAction<string | null>>
  policyLinkNodePath: string | null
  setPolicyLinkNodePath: Dispatch<SetStateAction<string | null>>
}

const ModelContext = createContext<ModelContextValue | undefined>(undefined)

const EMPTY_MODEL: Model = {
  id: '',
  name: '',
  format: 'rac',
  nodes: {},
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

  const [rightBar, setRightBar] = useState<RightBarOptions>(null)
  const [logicYear, setLogicYear] = useState<number>(new Date().getFullYear())
  const [asOfDate, setAsOfDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  )

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

  // Keep refs of the current execution inputs so runExecution doesn't need
  // them in its dep list. Without this, the callback's closure is captured

  const [workspaceItems, setWorkspaceItems] = useLocalStorage<string[]>(
    `workspace:${rulesetId}`,
    []
  )
  const [activeTest, setActiveTest] = useState<{
    expectations: Record<
      string,
      { expected: unknown; actual: unknown; passed: boolean }
    >
    inputs: Record<string, unknown>
    computedValues: Record<string, unknown>
  } | null>(null)

  const [policyTargetPage, setPolicyTargetPage] = useState<number | null>(null)
  const [policyFocusSectionIds, setPolicyFocusSectionIds] = useState<
    string[] | null
  >(null)
  const [policyTargetDocId, setPolicyTargetDocId] = useState<string | null>(
    null
  )
  const [policyLinkNodePath, setPolicyLinkNodePath] = useState<string | null>(
    null
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

  // Silent refetch — used after writes (e.g. saveReferences). Refreshes the
  // model in place without flipping isLoading, so HomePage doesn't unmount
  // the whole layout (which resets resizable-panel sizes).
  const refreshModel = useCallback(() => {
    getRuleset(rulesetId)
      .then((data) => {
        setModel(data)
        if (data.name) updateTabName(rulesetId, data.name)
      })
      .catch((err) => {
        console.error('Silent refresh failed:', err)
      })
  }, [rulesetId, updateTabName])

  // Load model from API
  useEffect(() => {
    loadModel()
  }, [loadModel])

  // Pick up pending scenario from simulation bridge (if any)
  useEffect(() => {
    if (model.id === '' || Object.keys(model.nodes).length === 0) return
    const scenario = consumePendingScenario(rulesetId)
    if (!scenario) return

    // Map input paths to node IDs and set overrides
    const overrides: Record<string, string> = {}
    for (const [inputPath, value] of Object.entries(scenario.inputs)) {
      // Node IDs are paths in FG rulesets
      if (model.nodes[inputPath]) {
        overrides[inputPath] =
          typeof value === 'string' ? value : JSON.stringify(value)
      }
    }
    setInputOverrides(overrides)

    // Set entity data
    if (scenario.entities) {
      const ed: Record<string, Record<string, string>[]> = {}
      for (const [coll, rows] of Object.entries(scenario.entities)) {
        ed[coll] = rows.map((row) => {
          const stringRow: Record<string, string> = {}
          for (const [k, v] of Object.entries(row)) {
            stringRow[k] = typeof v === 'string' ? v : JSON.stringify(v)
          }
          return stringRow
        })
      }
      setEntityData(ed)
    }

    // Focus a specific node if requested (from simulation node link)
    if (scenario.focusNode && model.nodes[scenario.focusNode]) {
      setSelectedNodes([scenario.focusNode])
      setPanelOpen(true)
      setNodeHistory([scenario.focusNode])
      setNodeHistoryIndex(0)
    }

    // Open execution panel and trigger a run after a tick
    setRightBar('execution')
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('simulation-scenario-loaded'))
    })
  }, [
    model,
    rulesetId,
    setInputOverrides,
    setEntityData,
    setRightBar,
    setSelectedNodes,
    setPanelOpen,
    setNodeHistory,
    setNodeHistoryIndex,
  ])

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

  // Live reload: re-fetch when backend notifies of file changes. Use the
  // silent refresh so editing an XML file doesn't blank the whole layout
  // and reset the user's panel sizes.
  useEffect(() => {
    return onReload((changedRulesetId) => {
      if (!changedRulesetId || changedRulesetId === rulesetId) {
        refreshModel()
      }
    })
  }, [rulesetId, refreshModel])

  const value: ModelContextValue = useMemo(
    () => ({
      rulesetId,
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
      nodeHistory,
      setNodeHistory,
      nodeHistoryIndex,
      setNodeHistoryIndex,
      panelOpen,
      setPanelOpen,
      rightBar,
      setRightBar,
      logicYear,
      setLogicYear,
      asOfDate,
      setAsOfDate,
      inputOverrides,
      setInputOverrides,
      entityData,
      setEntityData,
      executionResults,
      setExecutionResults,
      isExecuting,
      setIsExecuting,
      executionError,
      setExecutionError,
      workspaceItems,
      setWorkspaceItems,
      activeTest,
      setActiveTest,
      refreshModel,
      policyTargetPage,
      setPolicyTargetPage,
      policyFocusSectionIds,
      setPolicyFocusSectionIds,
      policyTargetDocId,
      setPolicyTargetDocId,
      policyLinkNodePath,
      setPolicyLinkNodePath,
    }),
    [
      rulesetId,
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
      nodeHistory,
      nodeHistoryIndex,
      panelOpen,
      rightBar,
      setRightBar,
      logicYear,
      setLogicYear,
      asOfDate,
      setAsOfDate,
      inputOverrides,
      entityData,
      setEntityData,
      executionResults,
      isExecuting,
      executionError,
      workspaceItems,
      setWorkspaceItems,
      activeTest,
      setActiveTest,
      loadModel,
      refreshModel,
      policyTargetPage,
      policyFocusSectionIds,
      policyTargetDocId,
      policyLinkNodePath,
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
