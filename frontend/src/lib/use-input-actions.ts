import { useCallback, useMemo } from 'react'
import { useModelContext, isInputNode } from '@/context/model-context'

/**
 * Action helpers for the execution-state slice that used to live inside
 * ModelContext. Splits the orchestration logic out so the context stays a
 * thin get/set surface.
 *
 * Returns:
 *   setInputOverride(id, value)  — set a single override
 *   clearInputOverride(id)       — clear a single override
 *   clearOverrides()             — wipe constant/computed overrides;
 *                                  keep user-typed input values + entities
 *   clearAll()                   — wipe everything (overrides, entities,
 *                                  results, errors)
 */
export function useInputActions() {
  const {
    model,
    setInputOverrides,
    setEntityData,
    setExecutionResults,
    setExecutionError,
  } = useModelContext()

  const setInputOverride = useCallback(
    (nodeId: string, value: string) => {
      setInputOverrides((prev) => ({ ...prev, [nodeId]: value }))
    },
    [setInputOverrides]
  )

  const clearInputOverride = useCallback(
    (nodeId: string) => {
      setInputOverrides((prev) => {
        const next = { ...prev }
        delete next[nodeId]
        return next
      })
    },
    [setInputOverrides]
  )

  const clearOverrides = useCallback(() => {
    setInputOverrides((prev) => {
      const next: Record<string, string> = {}
      for (const [nodeId, value] of Object.entries(prev)) {
        const node = model.nodes[nodeId]
        if (node && isInputNode(node)) next[nodeId] = value
      }
      return next
    })
    setExecutionResults(null)
    setExecutionError(null)
  }, [model.nodes, setInputOverrides, setExecutionResults, setExecutionError])

  const clearAll = useCallback(() => {
    setInputOverrides({})
    setEntityData({})
    setExecutionResults(null)
    setExecutionError(null)
  }, [setInputOverrides, setEntityData, setExecutionResults, setExecutionError])

  return useMemo(
    () => ({
      setInputOverride,
      clearInputOverride,
      clearOverrides,
      clearAll,
    }),
    [setInputOverride, clearInputOverride, clearOverrides, clearAll]
  )
}
