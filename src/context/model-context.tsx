import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import type { Model, ModelNode } from '@/lib/model'
import { getRuleset } from '@/lib/api/rules-api'
import { useLocalStorage } from '@/lib/use-local-storage'
import { useAppContext } from './app-context'

type RightBarOptions = 'ai' | null

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
  const [openNode, setOpenNode] = useState<string | null>(null)
  const [rightBar, setRightBar] = useState<RightBarOptions>(null)

  // Load model from API
  useEffect(() => {
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

  const value: ModelContextValue = {
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
  }

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
