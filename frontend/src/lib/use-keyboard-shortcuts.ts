import { useEffect } from 'react'
import { useModelContext } from '@/context/model-context'

function isInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable
}

export function useKeyboardShortcuts() {
  const {
    openNode,
    setOpenNode,
    goBackNode,
    goForwardNode,
    rightBar,
    setRightBar,
  } = useModelContext()

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Always allow Escape
      if (e.key === 'Escape') {
        if (isInputFocused()) {
          (document.activeElement as HTMLElement)?.blur()
          return
        }
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

      // Skip all other shortcuts if an input is focused
      if (isInputFocused()) return

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          goBackNode()
          break
        case 'ArrowRight':
          e.preventDefault()
          goForwardNode()
          break
        case '/':
        case 'k':
          e.preventDefault()
          document.querySelector<HTMLInputElement>('[placeholder="Search..."]')?.focus()
          break
        case 'h':
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('open-history'))
          break
        case 'a':
          e.preventDefault()
          setRightBar(rightBar === 'ai' ? null : 'ai')
          if (rightBar !== 'ai') {
            setTimeout(() => {
              document.querySelector<HTMLTextAreaElement>('.border-t textarea')?.focus()
            }, 100)
          }
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [openNode, setOpenNode, goBackNode, goForwardNode, rightBar, setRightBar])
}
