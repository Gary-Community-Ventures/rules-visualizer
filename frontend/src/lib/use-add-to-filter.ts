import { useCallback } from 'react'
import { useModelContext } from '@/context/model-context'
import { nodeElementId } from '@/components/node'

/**
 * Add a node to the filter. On the first add (when the node isn't already in
 * the filter), also collapses children on every other filtered node so the
 * newly added node becomes the focal point. Use this from the filter button
 * and keyboard shortcut — not from the search bar, which should add silently.
 *
 * Also scrolls the newly added node into view, anchored at the top-middle of
 * the screen, so the user lands on it after the filter rerender.
 */
export function useAddToFilter() {
  const { rulesetId, setSelectedNodes, setShowChildren } = useModelContext()

  return useCallback(
    (nodeId: string) => {
      let didAdd = false
      setSelectedNodes((prev) => {
        if (prev.includes(nodeId)) return prev
        didAdd = true
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
      if (didAdd) {
        // The graph canvas uses CSS transforms (not native scroll), so we
        // can't scrollIntoView — dispatch a pan-to-element event that
        // PanContainer listens for and translates the canvas to put the
        // element at the top-middle of the container. Wait a tick first
        // so the filter rerender + collapse-others state updates settle
        // before we measure the element's post-layout position.
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent('pan-to-element', {
              detail: { elementId: nodeElementId(rulesetId, nodeId) },
            })
          )
        }, 150)
      }
    },
    [rulesetId, setSelectedNodes, setShowChildren]
  )
}
