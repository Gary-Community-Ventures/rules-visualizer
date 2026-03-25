import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  type ReactNode,
} from 'react'
import { useLocalStorage } from '@/lib/use-local-storage'
import { connectLiveReload } from '@/lib/api/live-reload'

export type Tab = {
  rulesetId: string
  rulesetName: string
}

type AppContextValue = {
  tabs: Tab[]
  openTab: (rulesetId: string, rulesetName: string) => void
  closeTab: (rulesetId: string) => void
  updateTabName: (rulesetId: string, rulesetName: string) => void
}

const AppContext = createContext<AppContextValue | undefined>(undefined)

export function AppProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useLocalStorage<Tab[]>('rules-visualizer-tabs', [])

  // Connect live reload WebSocket on mount
  useEffect(() => {
    connectLiveReload()
  }, [])

  const openTab = useCallback(
    (rulesetId: string, rulesetName: string) => {
      setTabs((prev) => {
        if (prev.some((t) => t.rulesetId === rulesetId)) {
          return prev
        }
        return [...prev, { rulesetId, rulesetName }]
      })
    },
    [setTabs]
  )

  const closeTab = useCallback(
    (rulesetId: string) => {
      setTabs((prev) => prev.filter((t) => t.rulesetId !== rulesetId))
    },
    [setTabs]
  )

  const updateTabName = useCallback(
    (rulesetId: string, rulesetName: string) => {
      setTabs((prev) =>
        prev.map((t) => (t.rulesetId === rulesetId ? { ...t, rulesetName } : t))
      )
    },
    [setTabs]
  )

  const value: AppContextValue = {
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
