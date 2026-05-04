import { useCallback, useMemo } from 'react'
import { useModelContext } from '@/context/model-context'

/**
 * Imperative actions over the policy panel's pending-navigation state.
 * Splits orchestration (open + scroll + flip the right bar) out of
 * ModelContext so the context just owns the raw state + setters.
 */
export function usePolicyNavigation() {
  const {
    setRightBar,
    setPolicyTargetPage,
    setPolicyFocusSectionIds,
    setPolicyTargetDocId,
    setPolicyLinkNodePath,
  } = useModelContext()

  const openPolicyAtPage = useCallback(
    (page: number, focusSectionIds?: string[], documentId?: string) => {
      setPolicyTargetPage(page)
      setPolicyFocusSectionIds(focusSectionIds ?? null)
      setPolicyTargetDocId(documentId ?? null)
      setRightBar('policy')
    },
    [
      setRightBar,
      setPolicyTargetPage,
      setPolicyFocusSectionIds,
      setPolicyTargetDocId,
    ]
  )

  const openPolicyForLinking = useCallback(
    (nodePath: string) => {
      setPolicyLinkNodePath(nodePath)
      setRightBar('policy')
    },
    [setRightBar, setPolicyLinkNodePath]
  )

  const clearPolicyTarget = useCallback(() => {
    setPolicyTargetPage(null)
    setPolicyFocusSectionIds(null)
    setPolicyTargetDocId(null)
  }, [setPolicyTargetPage, setPolicyFocusSectionIds, setPolicyTargetDocId])

  const clearPolicyLinkNode = useCallback(() => {
    setPolicyLinkNodePath(null)
  }, [setPolicyLinkNodePath])

  return useMemo(
    () => ({
      openPolicyAtPage,
      openPolicyForLinking,
      clearPolicyTarget,
      clearPolicyLinkNode,
    }),
    [
      openPolicyAtPage,
      openPolicyForLinking,
      clearPolicyTarget,
      clearPolicyLinkNode,
    ]
  )
}
