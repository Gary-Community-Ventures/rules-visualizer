import { useCallback, useMemo } from 'react'
import { useModelContext } from '@/context/model-context'

/**
 * Imperative actions over the node-detail panel's history. The "open
 * node" pointer is derived (panelOpen + nodeHistory[index]); these
 * helpers maintain the stack as the user navigates.
 *
 * Returns:
 *   setOpenNode(id|null)     — open id (push history if new); null closes panel
 *   goBackNode()             — step back, or re-open the panel without changing position
 *   goForwardNode()          — step forward in history
 *   goToHistoryIndex(i)      — jump to a specific entry
 */
export function useNodeNavigation() {
  const {
    nodeHistory,
    setNodeHistory,
    nodeHistoryIndex,
    setNodeHistoryIndex,
    panelOpen,
    setPanelOpen,
  } = useModelContext()

  const setOpenNode = useCallback(
    (nodeId: string | null) => {
      if (nodeId === null) {
        setPanelOpen(false)
        return
      }
      setPanelOpen(true)
      const current = nodeHistoryIndex >= 0 ? nodeHistory[nodeHistoryIndex] : null
      if (nodeId !== current) {
        setNodeHistory((prev) => [
          ...prev.slice(0, nodeHistoryIndex + 1),
          nodeId,
        ])
        setNodeHistoryIndex((prev) => prev + 1)
      }
    },
    [
      nodeHistory,
      nodeHistoryIndex,
      setNodeHistory,
      setNodeHistoryIndex,
      setPanelOpen,
    ]
  )

  const goBackNode = useCallback(() => {
    if (!panelOpen && nodeHistoryIndex >= 0) {
      setPanelOpen(true)
    } else if (nodeHistoryIndex > 0) {
      setNodeHistoryIndex((i) => i - 1)
      setPanelOpen(true)
    }
  }, [panelOpen, nodeHistoryIndex, setNodeHistoryIndex, setPanelOpen])

  const goForwardNode = useCallback(() => {
    if (nodeHistoryIndex < nodeHistory.length - 1) {
      setNodeHistoryIndex((i) => i + 1)
      setPanelOpen(true)
    }
  }, [nodeHistoryIndex, nodeHistory.length, setNodeHistoryIndex, setPanelOpen])

  const goToHistoryIndex = useCallback(
    (index: number) => {
      if (index >= 0 && index < nodeHistory.length) {
        setNodeHistoryIndex(index)
        setPanelOpen(true)
      }
    },
    [nodeHistory.length, setNodeHistoryIndex, setPanelOpen]
  )

  return useMemo(
    () => ({ setOpenNode, goBackNode, goForwardNode, goToHistoryIndex }),
    [setOpenNode, goBackNode, goForwardNode, goToHistoryIndex]
  )
}
