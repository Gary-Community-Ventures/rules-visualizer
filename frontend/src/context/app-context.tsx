import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from 'react'
import { useLocalStorage } from '@/lib/use-local-storage'
import { connectLiveReload } from '@/lib/api/live-reload'
import { listRulesets } from '@/lib/api/rules-api'

export type Tab = {
  rulesetId: string
  rulesetName: string
}

type AppContextValue = {
  tabs: Tab[]
  openTab: (rulesetId: string, rulesetName: string) => void
  closeTab: (rulesetId: string) => void
  updateTabName: (rulesetId: string, rulesetName: string) => void
  /** Set of rulesetIds that were explicitly closed this session.
   *  Prevents RulesetActivator from immediately re-opening them. */
  closedTabs: Set<string>
}

const AppContext = createContext<AppContextValue | undefined>(undefined)

export function AppProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useLocalStorage<Tab[]>('rules-visualizer-tabs', [])
  const closedTabsRef = useRef(new Set<string>())

  // Connect live reload WebSocket on mount
  useEffect(() => {
    connectLiveReload()
  }, [])

  // On mount, validate stored tabs against the current backend.
  // Remove any tabs for rulesets that no longer exist.
  useEffect(() => {
    listRulesets()
      .then((rulesets) => {
        const validIds = new Set(rulesets.map((r) => r.id))
        setTabs((prev) => {
          const filtered = prev.filter((t) => validIds.has(t.rulesetId))
          return filtered.length === prev.length ? prev : filtered
        })
      })
      .catch(() => {
        // If backend is unreachable, don't nuke tabs
      })
  }, [setTabs])

  const openTab = useCallback(
    (rulesetId: string, rulesetName: string) => {
      // Clear from closed set if re-opening
      closedTabsRef.current.delete(rulesetId)
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
      closedTabsRef.current.add(rulesetId)
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
    closedTabs: closedTabsRef.current,
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
