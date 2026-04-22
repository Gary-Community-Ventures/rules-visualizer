import { useCallback } from 'react'
import { useModelContext } from '@/context/model-context'

/**
 * Add a node to the filter. On the first add (when the node isn't already in
 * the filter), also collapses children on every other filtered node so the
 * newly added node becomes the focal point. Use this from the filter button
 * and keyboard shortcut — not from the search bar, which should add silently.
 */
export function useAddToFilter() {
  const { setSelectedNodes, setShowChildren } = useModelContext()

  return useCallback(
    (nodeId: string) => {
      setSelectedNodes((prev) => {
        if (prev.includes(nodeId)) return prev
        setShowChildren((sc) => {
          let changed = false
          const next = { ...sc }
          for (const id of prev) {
            if (next[id] !== false) {
              next[id] = false
              changed = true
            }
          }
          return changed ? next : sc
        })
        return [...prev, nodeId]
      })
    },
    [setSelectedNodes, setShowChildren]
  )
}
