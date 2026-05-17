import { useCallback, useMemo } from 'react'
import { useModelContext, type Workspace } from '@/context/model-context'

/**
 * Imperative actions over the workspace list. Each workspace owns its own
 * saved-nodes bag (`items`) and search-bar chips (`selectedNodes`); the
 * model-context exposes only the raw state, and these helpers do the
 * create / remove / switch bookkeeping (id allocation, fallback when the
 * last workspace is deleted, side-effects of switching).
 *
 * Returns:
 *   createWorkspace(init?)         — append a workspace and make it active; returns its id
 *   removeWorkspace(id)            — delete; if it was active, switch to the next remaining
 *   switchWorkspace(id)            — make `id` active
 */
export function useWorkspaceActions() {
  const {
    workspaces,
    setWorkspaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
  } = useModelContext()

  const createWorkspace = useCallback(
    (init?: { items?: string[]; selectedNodes?: string[] }): string => {
      const id = `ws-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 6)}`
      const fresh: Workspace = {
        id,
        items: init?.items ?? [],
        selectedNodes: init?.selectedNodes ?? [],
      }
      setWorkspaces((prev) => [...prev, fresh])
      setActiveWorkspaceId(id)
      return id
    },
    [setWorkspaces, setActiveWorkspaceId]
  )

  const removeWorkspace = useCallback(
    (id: string) => {
      setWorkspaces((prev) => {
        const next = prev.filter((w) => w.id !== id)
        // Never end up with zero workspaces — seed a fresh empty default
        // if the user just deleted the last one. The caller's call to
        // setActiveWorkspaceId below picks it up.
        if (next.length === 0) {
          const fresh: Workspace = {
            id: 'default',
            items: [],
            selectedNodes: [],
          }
          setActiveWorkspaceId(fresh.id)
          return [fresh]
        }
        if (id === activeWorkspaceId) setActiveWorkspaceId(next[0].id)
        return next
      })
    },
    [activeWorkspaceId, setWorkspaces, setActiveWorkspaceId]
  )

  const switchWorkspace = useCallback(
    (id: string) => {
      if (workspaces.some((w) => w.id === id)) setActiveWorkspaceId(id)
    },
    [workspaces, setActiveWorkspaceId]
  )

  return useMemo(
    () => ({ createWorkspace, removeWorkspace, switchWorkspace }),
    [createWorkspace, removeWorkspace, switchWorkspace]
  )
}
