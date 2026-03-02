import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  type ReactNode,
} from 'react'
import { socket } from '@/lib/sockets'
import { useLocalStorage } from '@/lib/use-local-storage'
import type { Socket } from 'socket.io-client'

export type Tab = {
  projectId: string
  modelId: string
  modelName: string
}

type AppContextValue = {
  socket: Socket
  tabs: Tab[]
  openTab: (projectId: string, modelId: string, modelName: string) => void
  closeTab: (modelId: string) => void
  updateTabName: (modelId: string, modelName: string) => void
}

const AppContext = createContext<AppContextValue | undefined>(undefined)

export function AppProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useLocalStorage<Tab[]>('dmn-editor-tabs', [])

  // One-time migration: drop stale data from before the project refactor
  useEffect(() => {
    if (tabs.some((t) => !t.projectId)) {
      setTabs((prev) => prev.filter((t) => t.projectId))
    }
    // Clean up old global showChildren key (now per-model)
    localStorage.removeItem('showChildren')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openTab = useCallback(
    (projectId: string, modelId: string, modelName: string) => {
      setTabs((prev) => {
        if (prev.some((t) => t.modelId === modelId)) {
          return prev
        }
        return [...prev, { projectId, modelId, modelName }]
      })
    },
    [setTabs]
  )

  const closeTab = useCallback(
    (modelId: string) => {
      setTabs((prev) => prev.filter((t) => t.modelId !== modelId))
    },
    [setTabs]
  )

  const updateTabName = useCallback(
    (modelId: string, modelName: string) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.modelId === modelId ? { ...t, modelName } : t
        )
      )
    },
    [setTabs]
  )

  const value: AppContextValue = {
    socket,
    tabs,
    openTab,
    closeTab,
    updateTabName,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) {
    throw new Error("'useAppContext' must be used within AppProvider")
  }
  return ctx
}
