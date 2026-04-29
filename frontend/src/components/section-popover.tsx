import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { X, Hammer } from 'lucide-react'
import type { PolicySection } from '@/lib/model'
import { Button } from './ui/button'
import { cn } from '@/lib/utils'

const POPOVER_WIDTH = 380
const VIEWPORT_PAD = 8

/**
 * Floating section editor — opens when a saved policy section is clicked
 * on a PDF page. Auto-saves every change with a debounce; you never click
 * a save button. Positioned via portal to body so it stays on screen even
 * when the section's box is enormous or near a viewport edge.
 */
export function SectionPopover({
  section,
  pageWrapper,
  editable = true,
  isSkipped,
  linkedNames,
  onLinkedNamesChange,
  onCommentChange,
  onRemove,
  onClose,
  onOpenNode,
  onUseInTaskBuilder,
  alreadyInTaskBuilder,
  nodeOptions,
  openNodeName,
  saving,
}: {
  section: PolicySection
  pageWrapper: HTMLElement | null
  /** When false, the popover renders read-only: no comment input, no node
   *  picker, no remove or "Use in task" buttons. The user can still see
   *  the linked nodes (clickable to open) and the saved comment text. */
  editable?: boolean
  isSkipped: boolean
  linkedNames: string[]
  onLinkedNamesChange: (names: string[]) => void
  onCommentChange: (comment: string) => void
  onRemove: () => void
  onClose: () => void
  onOpenNode: (nodeName: string) => void
  /** Click handler for the task-builder button. Caller decides whether to
   *  attach (default) or just navigate (when already attached). */
  onUseInTaskBuilder?: () => void
  /** True when this section is already attached to the task builder; flips
   *  the button label from "Use in task" to "See in task". */
  alreadyInTaskBuilder?: boolean
  /** Pool of pickable nodes — { name } pairs from the model. */
  nodeOptions: { name: string }[]
  /** Name of the node currently open in the side panel. When this matches
   *  the current search and isn't already linked, it's pinned to the top
   *  of the suggestions list — typical workflow is "I'm reading X, link
   *  this section to it". */
  openNodeName?: string
  saving: boolean
}) {
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const linkedSet = useMemo(() => new Set(linkedNames), [linkedNames])
  const suggestions = useMemo(() => {
    if (!search.trim()) return []
    const q = search.toLowerCase()
    // Pin the side-panel's open node to the top when it matches and isn't
    // already linked; then sort the rest by exact-match-first, then by
    // name length (shortest first — usually the most specific match), with
    // a stable alphabetical tiebreaker so order doesn't jitter.
    const matches = nodeOptions.filter(
      (n) => !linkedSet.has(n.name) && n.name.toLowerCase().includes(q)
    )
    const pinName =
      openNodeName && matches.some((n) => n.name === openNodeName)
        ? openNodeName
        : null
    const rest = pinName
      ? matches.filter((n) => n.name !== pinName)
      : matches
    rest.sort((a, b) => {
      const aExact = a.name.toLowerCase() === q ? 0 : 1
      const bExact = b.name.toLowerCase() === q ? 0 : 1
      if (aExact !== bExact) return aExact - bExact
      if (a.name.length !== b.name.length) return a.name.length - b.name.length
      return a.name.localeCompare(b.name)
    })
    const ordered = pinName ? [{ name: pinName }, ...rest] : rest
    return ordered.slice(0, 20)
  }, [nodeOptions, linkedSet, search, openNodeName])

  // Keep selectedIndex in range as suggestions change.
  useEffect(() => {
    setSelectedIndex(0)
  }, [search])

  const addLinkedName = (name: string) => {
    if (linkedSet.has(name)) return
    onLinkedNamesChange([...linkedNames, name])
    setSearch('')
  }
  const removeLinkedName = (name: string) => {
    onLinkedNamesChange(linkedNames.filter((n) => n !== name))
  }

  // Computed viewport coordinates for the floating popover.
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  useLayoutEffect(() => {
    const compute = () => {
      if (!pageWrapper) return
      const rect = section.rects?.[section.rects.length - 1]
      if (!rect) return
      const wrap = pageWrapper.getBoundingClientRect()

      // Box bounds in viewport coords.
      const boxTop = wrap.top + rect.y * wrap.height
      const boxBottom = wrap.top + (rect.y + rect.h) * wrap.height
      const boxLeft = wrap.left + rect.x * wrap.width

      // Visible portion of the box (clamped to viewport). Anchor the popover
      // off the visible edges so a giant box that extends offscreen still
      // gets a popover at a sensible y-coordinate.
      const visibleTop = Math.max(boxTop, VIEWPORT_PAD)
      const visibleBottom = Math.min(
        boxBottom,
        window.innerHeight - VIEWPORT_PAD
      )

      // Use measured popover height once it's rendered; estimate first paint.
      const popH = popoverRef.current?.offsetHeight ?? 320

      // Prefer below the visible bottom edge → above the visible top edge →
      // pinned to the viewport top if neither fits (box bigger than viewport).
      const spaceBelow = window.innerHeight - visibleBottom - VIEWPORT_PAD
      const spaceAbove = visibleTop - VIEWPORT_PAD
      let top: number
      if (spaceBelow >= popH + 4) {
        top = visibleBottom + 4
      } else if (spaceAbove >= popH + 4) {
        top = visibleTop - popH - 4
      } else {
        top = VIEWPORT_PAD
      }

      const left = Math.max(
        VIEWPORT_PAD,
        Math.min(window.innerWidth - POPOVER_WIDTH - VIEWPORT_PAD, boxLeft)
      )
      // Avoid an infinite re-render loop: skip if the position hasn't moved.
      setPos((prev) =>
        prev && prev.top === top && prev.left === left ? prev : { top, left }
      )
    }
    compute()
    const onScroll = () => compute()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
    // pos is read inside compute via popoverRef, but we re-run when pos
    // is first assigned so that compute can use the now-mounted popover
    // height for an accurate flip decision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageWrapper, section.rects, section.id, pos === null])

  // Debounced comment autosave. Local draft so the textarea stays
  // responsive while saves trickle out at most once per 400ms.
  const [commentDraft, setCommentDraft] = useState(section.comment ?? '')
  const lastSavedCommentRef = useRef(section.comment ?? '')
  useEffect(() => {
    // Resync if the section's saved comment changes externally.
    setCommentDraft(section.comment ?? '')
    lastSavedCommentRef.current = section.comment ?? ''
  }, [section.id, section.comment])

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleCommentSave = (val: string) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      if (val.trim() !== lastSavedCommentRef.current.trim()) {
        lastSavedCommentRef.current = val
        onCommentChange(val)
      }
    }, 400)
  }
  // Flush pending save when popover unmounts.
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
        if (commentDraft.trim() !== lastSavedCommentRef.current.trim()) {
          onCommentChange(commentDraft)
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!pos) return null

  return createPortal(
    <div
      ref={popoverRef}
      data-policy-popover
      className="fixed z-50 bg-popover text-popover-foreground border rounded-md shadow-lg p-3 space-y-2.5"
      style={{
        top: pos.top,
        left: pos.left,
        width: POPOVER_WIDTH,
        maxWidth: `calc(100vw - ${VIEWPORT_PAD * 2}px)`,
        maxHeight: `calc(100vh - ${VIEWPORT_PAD * 2}px)`,
        overflowY: 'auto',
      }}
    >
      <div className="flex items-center justify-end">
        <button
          className="p-0.5 text-muted-foreground hover:text-foreground shrink-0"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </button>
      </div>

      {isSkipped ? (
        <div className="space-y-2.5">
          <p className="text-[11px] text-muted-foreground italic">
            Marked as skipped
          </p>
          {(editable || section.comment) && (
            <div className="space-y-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Comment
              </span>
              {editable ? (
                <textarea
                  className={cn(
                    'w-full text-xs border rounded px-2 py-1.5 bg-background resize-y min-h-[60px]',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
                  )}
                  placeholder="Add a comment (optional)…"
                  value={commentDraft}
                  onChange={(e) => {
                    setCommentDraft(e.target.value)
                    scheduleCommentSave(e.target.value)
                  }}
                />
              ) : (
                <p className="text-xs whitespace-pre-wrap text-foreground/90">
                  {section.comment}
                </p>
              )}
            </div>
          )}
          {editable && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs w-full"
              onClick={onRemove}
              disabled={saving}
            >
              Remove marking
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* Linked nodes — picker only when editable; otherwise the saved
              list is rendered as plain clickable links. */}
          <div className="space-y-1.5">
            {editable && (
              <div className="relative">
                <input
                  className="w-full h-7 text-xs border rounded px-2 bg-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="Link a node…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (suggestions.length === 0) return
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setSelectedIndex((i) => (i + 1) % suggestions.length)
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      setSelectedIndex(
                        (i) =>
                          (i - 1 + suggestions.length) % suggestions.length
                      )
                    } else if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault()
                      addLinkedName(suggestions[selectedIndex].name)
                    } else if (e.key === 'Escape') {
                      setSearch('')
                    }
                  }}
                />
                {suggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 max-h-48 overflow-y-auto rounded-md border bg-popover shadow-md z-10">
                    {suggestions.map((n, i) => (
                      <button
                        key={n.name}
                        type="button"
                        className={cn(
                          'flex w-full items-center px-2 py-1 text-xs text-left',
                          i === selectedIndex
                            ? 'bg-accent text-accent-foreground'
                            : 'hover:bg-accent/50'
                        )}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          addLinkedName(n.name)
                        }}
                      >
                        <span className="font-mono truncate">{n.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {linkedNames.length > 0 && (
              <ul className="border rounded-md divide-y bg-background">
                {linkedNames.map((name) => (
                  <li
                    key={name}
                    className="flex items-center gap-1 px-2 py-1 hover:bg-muted/40"
                  >
                    <button
                      type="button"
                      className="flex-1 min-w-0 text-left text-xs font-mono text-violet-700 hover:underline truncate"
                      onClick={() => onOpenNode(name)}
                    >
                      {name}
                    </button>
                    {editable && (
                      <button
                        type="button"
                        className="p-0.5 text-muted-foreground hover:text-red-600 shrink-0"
                        onClick={() => removeLinkedName(name)}
                        title="Remove link"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Comment — editable input when allowed, plain text when not. */}
          {(editable || section.comment) && (
            <div className="space-y-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Comment
              </span>
              {editable ? (
                <textarea
                  className={cn(
                    'w-full text-xs border rounded px-2 py-1.5 bg-background resize-y min-h-[60px]',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
                  )}
                  placeholder="Add a comment (optional)…"
                  value={commentDraft}
                  onChange={(e) => {
                    setCommentDraft(e.target.value)
                    scheduleCommentSave(e.target.value)
                  }}
                />
              ) : (
                <p className="text-xs whitespace-pre-wrap text-foreground/90">
                  {section.comment}
                </p>
              )}
            </div>
          )}

          {/* Empty-state placeholder so the popover doesn't look like a
              ghost card when a read-only section has neither links nor
              a comment. */}
          {!editable &&
            linkedNames.length === 0 &&
            !section.comment && (
              <p className="text-[11px] text-muted-foreground italic text-center py-2">
                No linked nodes or comment for this section.
              </p>
            )}

          {editable && (
            <div className="flex items-center gap-1.5 pt-1">
              {onUseInTaskBuilder && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[11px] gap-1"
                  onClick={onUseInTaskBuilder}
                  title={
                    alreadyInTaskBuilder
                      ? 'Open the task builder (this section is already attached)'
                      : 'Attach this source to the task builder'
                  }
                >
                  <Hammer className="size-3" />
                  {alreadyInTaskBuilder ? 'See in task' : 'Use in task'}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[11px] text-red-600 hover:text-red-700 hover:bg-red-50 ml-auto"
                onClick={onRemove}
                disabled={saving}
              >
                Remove section
              </Button>
            </div>
          )}
        </>
      )}
    </div>,
    document.body
  )
}
