import { useEffect } from 'react'
import { useModelContext, getNodePath } from '@/context/model-context'
import { useAddToFilter } from './use-add-to-filter'
import { usePolicyNavigation } from './use-policy-navigation'
import { useNodeNavigation } from './use-node-navigation'
import { nodeElementId } from '@/components/node'

function isInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    (el as HTMLElement).isContentEditable
  )
}

let autoCloseTimer: ReturnType<typeof setTimeout> | null = null
let activeDropdown: 'history' | 'workspace' | null = null
let dropdownClosedAt = 0

function isAnyDropdownOpen(): boolean {
  return !!document.querySelector('[data-radix-popper-content-wrapper]')
}

function isAnyDialogOpen(): boolean {
  return !!document.querySelector('[role="dialog"][data-state="open"]')
}

function openTemporarily(name: 'history' | 'workspace') {
  if (isAnyDropdownOpen()) return

  window.dispatchEvent(new CustomEvent(`open-${name}`))
  activeDropdown = name
  if (autoCloseTimer) clearTimeout(autoCloseTimer)
  autoCloseTimer = setTimeout(() => {
    window.dispatchEvent(new CustomEvent(`close-${name}`))
    activeDropdown = null
    autoCloseTimer = null
  }, 500)
}

export function useKeyboardShortcuts(active: boolean = true) {
  const {
    rulesetId,
    model,
    openNode,
    rightBar,
    setRightBar,
    workspaceItems,
    setWorkspaceItems,
    setShowChildren,
    selectedNodes,
    setSelectedNodes,
  } = useModelContext()
  const { setOpenNode, goBackNode, goForwardNode } = useNodeNavigation()
  const { openPolicyForLinking } = usePolicyNavigation()
  const addToFilter = useAddToFilter()

  useEffect(() => {
    if (!active) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (isInputFocused()) {
          ;(document.activeElement as HTMLElement)?.blur()
          return
        }
        if (isAnyDialogOpen() || isAnyDropdownOpen()) {
          dropdownClosedAt = Date.now()
          return
        }
        if (Date.now() - dropdownClosedAt < 100) return
        if (openNode) {
          setOpenNode(null)
          return
        }
        if (rightBar) {
          setRightBar(null)
          return
        }
        return
      }

      if (isInputFocused()) return

      // Up/Down: navigate workspace items (loops), but not when history is open
      if (
        (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
        activeDropdown !== 'history'
      ) {
        const validItems = workspaceItems.filter((id) => model.nodes[id])
        if (validItems.length > 0) {
          e.preventDefault()
          openTemporarily('workspace')
          const currentIndex = openNode ? validItems.indexOf(openNode) : -1
          let newIndex: number
          if (currentIndex === -1) {
            newIndex = e.key === 'ArrowUp' ? 0 : validItems.length - 1
          } else if (e.key === 'ArrowUp') {
            newIndex =
              (currentIndex - 1 + validItems.length) % validItems.length
          } else {
            newIndex = (currentIndex + 1) % validItems.length
          }
          setOpenNode(validItems[newIndex])
          return
        }
      }

      // Number keys 1-9: jump to workspace item
      if (e.key >= '1' && e.key <= '9') {
        const index = parseInt(e.key) - 1
        const validItems = workspaceItems.filter((id) => model.nodes[id])
        if (index < validItems.length) {
          e.preventDefault()
          openTemporarily('workspace')
          setOpenNode(validItems[index])
        }
        return
      }

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          openTemporarily('history')
          goBackNode()
          break
        case 'ArrowRight':
          e.preventDefault()
          openTemporarily('history')
          goForwardNode()
          break
        case '/':
        case 'k':
          e.preventDefault()
          document
            .querySelector<HTMLInputElement>('[placeholder="Search..."]')
            ?.focus()
          break
        case 'h':
          e.preventDefault()
          if (isAnyDropdownOpen()) {
            window.dispatchEvent(new CustomEvent('close-history'))
          } else {
            window.dispatchEvent(new CustomEvent('open-history'))
          }
          break
        case 'w':
          e.preventDefault()
          if (openNode) {
            if (workspaceItems.includes(openNode)) {
              setWorkspaceItems((prev) => prev.filter((id) => id !== openNode))
            } else {
              setWorkspaceItems((prev) => [...prev, openNode])
            }
          }
          break
        case 'e':
          e.preventDefault()
          if (isAnyDropdownOpen()) {
            window.dispatchEvent(new CustomEvent('close-workspace'))
          } else {
            window.dispatchEvent(new CustomEvent('open-workspace'))
          }
          break
        case 'a':
          e.preventDefault()
          setRightBar(rightBar === 'ai' ? null : 'ai')
          if (rightBar !== 'ai') {
            setTimeout(() => {
              document
                .querySelector<HTMLTextAreaElement>('.border-t textarea')
                ?.focus()
            }, 100)
          }
          break
        // Right-bar panels. Pressing the same key again toggles the panel
        // closed; otherwise switches to it.
        case 'p':
          e.preventDefault()
          setRightBar(rightBar === 'policy' ? null : 'policy')
          break
        case 'P': {
          // Shift+P opens the policy panel pre-wired to link a section
          // to the currently open node. Falls back to a plain open if no
          // node is open or it has no path.
          e.preventDefault()
          const nodePath = openNode
            ? getNodePath(model.nodes[openNode]?.content)
            : undefined
          if (nodePath) {
            openPolicyForLinking(nodePath)
          } else {
            setRightBar(rightBar === 'policy' ? null : 'policy')
          }
          break
        }
        case 't':
          e.preventDefault()
          setRightBar(rightBar === 'tests' ? null : 'tests')
          break
        case 'b':
          e.preventDefault()
          setRightBar(rightBar === 'tasks' ? null : 'tasks')
          break
        case 'i':
          e.preventDefault()
          setRightBar(rightBar === 'execution' ? null : 'execution')
          break
        case '?':
          // Cheatsheet — HomePage owns the modal state and listens for
          // this event so the hook stays state-free.
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('open-shortcuts'))
          break
        case '.':
          // Recenter the canvas on the currently open node — same flow
          // as add-to-filter (PanContainer pans + pulses).
          if (openNode) {
            e.preventDefault()
            window.dispatchEvent(
              new CustomEvent('pan-to-element', {
                detail: { elementId: nodeElementId(rulesetId, openNode) },
              })
            )
          }
          break
        case 'x':
          e.preventDefault()
          if (openNode) {
            setShowChildren((prev) => ({
              ...prev,
              [openNode]: prev[openNode] !== true,
            }))
          }
          break
        case 'f':
          e.preventDefault()
          if (openNode) {
            if (selectedNodes.includes(openNode)) {
              setSelectedNodes((prev) => prev.filter((id) => id !== openNode))
            } else {
              addToFilter(openNode)
            }
          }
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [
    active,
    rulesetId,
    openNode,
    setOpenNode,
    goBackNode,
    goForwardNode,
    rightBar,
    setRightBar,
    workspaceItems,
    setWorkspaceItems,
    setShowChildren,
    selectedNodes,
    setSelectedNodes,
    addToFilter,
    openPolicyForLinking,
    model.nodes,
  ])
}
