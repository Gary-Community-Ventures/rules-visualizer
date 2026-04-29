import { useState, useEffect, useCallback, useRef } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { useMainContext, usePanelContext } from '@/context'
import { getReferences, saveReferences } from '@/lib/api/rules-api'
import type {
  PolicyDocument,
  PolicyReferences,
  NormalizedRect,
  PolicySection,
} from '@/lib/model'
import { Button } from './ui/button'
import { ButtonGroup } from './ui/button-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import { SectionPopover } from './section-popover'
import { cn } from '@/lib/utils'
import { ALLOW_WRITES } from '@/lib/allow-writes'
import { FileText, X, Search, ChevronLeft, ChevronRight } from 'lucide-react'

// Configure pdf.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

const API_BASE = import.meta.env.VITE_API_URL ?? ''

// Module-level stores — survive component remounts from refreshModel().
// Mirror the same data into localStorage so the user's place persists
// across full page reloads too.
let _savedScrollTop = 0
let _savedDocId: string | null = null

const docKey = (rulesetId: string) => `policy-panel:doc:${rulesetId}`
const scrollKey = (rulesetId: string, docId: string) =>
  `policy-panel:scroll:${rulesetId}:${docId}`

function readStoredDocId(rulesetId: string): string | null {
  try {
    return localStorage.getItem(docKey(rulesetId))
  } catch {
    return null
  }
}
function writeStoredDocId(rulesetId: string, docId: string): void {
  try {
    localStorage.setItem(docKey(rulesetId), docId)
  } catch {
    // localStorage can throw in private browsing / quota-exceeded; the
    // module-level fallback still gets remounts within a session.
  }
}
function readStoredScroll(rulesetId: string, docId: string): number {
  try {
    const v = localStorage.getItem(scrollKey(rulesetId, docId))
    const n = v ? parseInt(v, 10) : 0
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}
function writeStoredScroll(
  rulesetId: string,
  docId: string,
  top: number
): void {
  try {
    localStorage.setItem(scrollKey(rulesetId, docId), String(Math.round(top)))
  } catch {
    // ignore
  }
}

/**
 * Walk pdf.js's text items on a page and concatenate the str of every item
 * whose bounding box overlaps the user-drawn box. Coords are normalized
 * 0-1 in our world and PDF user space (origin bottom-left) in pdf.js, so
 * we flip Y when comparing.
 */
/**
 * Walk pdf.js's text items and keep words whose bounding boxes are fully
 * inside the user's drawn box. We approximate per-word x-bounds by treating
 * the run's character widths as uniform — pdf.js doesn't expose per-glyph
 * positions, but uniform spacing is close enough for typical proportional
 * fonts and lets the user grab partial sentences without dragging in the
 * trailing word that overflows the box.
 */
async function extractTextInBox(
  pdfDoc: pdfjs.PDFDocumentProxy,
  pageNum: number,
  pdfDim: { width: number; height: number },
  box: { x: number; y: number; w: number; h: number }
): Promise<string> {
  const page = await pdfDoc.getPage(pageNum)
  const content = await page.getTextContent()
  const parts: string[] = []
  const boxLeft = box.x
  const boxRight = box.x + box.w
  const boxTop = box.y
  const boxBottom = box.y + box.h
  for (const item of content.items) {
    if (!('str' in item)) continue
    const str = item.str
    if (!str) continue
    const transform = (item as { transform: number[] }).transform
    const itemWidth = (item as { width: number }).width
    const itemHeight = (item as { height: number }).height
    if (itemWidth <= 0) continue

    // Item bbox in normalized coords (top-left origin).
    const top = (pdfDim.height - transform[5] - itemHeight) / pdfDim.height
    const bottom = (pdfDim.height - transform[5]) / pdfDim.height
    // Vertical containment: a word's vertical bounds match the run's.
    if (top < boxTop || bottom > boxBottom) continue

    // Walk runs of non-whitespace and decide per-word.
    const len = str.length
    let i = 0
    while (i < len) {
      while (i < len && /\s/.test(str[i])) i++
      if (i >= len) break
      const wordStart = i
      while (i < len && !/\s/.test(str[i])) i++
      const wordEnd = i
      const wordLeft =
        (transform[4] + (wordStart / len) * itemWidth) / pdfDim.width
      const wordRight =
        (transform[4] + (wordEnd / len) * itemWidth) / pdfDim.width
      if (wordLeft >= boxLeft && wordRight <= boxRight) {
        parts.push(str.slice(wordStart, wordEnd))
      }
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

export function PolicyPanel() {
  const {
    model,
    refreshModel,
    policyTargetPage,
    policyFocusSectionIds: activeSectionId,
    policyTargetDocId,
    clearPolicyTarget,
    openNode,
    setOpenNode,
    policyLinkNodePath,
    clearPolicyLinkNode,
    setRightBar,
  } = useMainContext()
  const {
    addTaskBuilderSource,
    taskBuilderSources,
    addFollowUpSource,
    followUpSources,
    attachTarget,
  } = usePanelContext()
  const [refs, setRefs] = useState<PolicyReferences | null>(null)
  const [selectedDoc, setSelectedDoc] = useState<PolicyDocument | null>(null)
  const [numPages, setNumPages] = useState<number>(0)
  // Intrinsic page dimensions (PDF user units) for each page, 0-indexed.
  // Used both for placeholder sizing pre-render and for caret-from-scroll math.
  const [pageDimensions, setPageDimensions] = useState<
    { width: number; height: number }[]
  >([])
  // Pages currently in (or near) the viewport — only these mount react-pdf <Page>.
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // Per-page wrapper refs, indexed 1..numPages to match react-pdf's pageNumber.
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const [containerWidth, setContainerWidth] = useState(0)

  // Search state
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<number[]>([])
  const [searchIndex, setSearchIndex] = useState(0)
  const [isSearching, setIsSearching] = useState(false)
  const [searchHighlight, setSearchHighlight] = useState('')
  const pdfDocRef = useRef<pdfjs.PDFDocumentProxy | null>(null)

  // Selected section in the PDF — shows linked nodes popover and the
  // blue overlay; cleared when the user closes the popover or clicks
  // another section.
  const [clickedSectionId, setClickedSectionId] = useState<string | null>(null)

  // What does drawing on a page do?
  //  - 'read'  — drawing disabled, native text selection works (copy etc.)
  //  - 'link'  — draw → opens link form to label + map nodes
  //  - 'skip'  — draw → saved immediately as a skipped section, no form
  type Mode = 'read' | 'link' | 'skip'
  const [mode, setMode] = useState<Mode>('read')
  // If the panel was opened from a node's '+ link' button, auto-switch to
  // link mode so the user's first draw goes straight into the form.
  useEffect(() => {
    if (policyLinkNodePath) setMode('link')
  }, [policyLinkNodePath])

  // Selection capture state — a single normalized box drawn by the user on
  // a single page. No text extraction; the box itself + page is all that's
  // stored. Replaces browser text-selection.
  const [capturedRects, setCapturedRects] = useState<NormalizedRect[]>([])
  const [selectionPage, setSelectionPage] = useState<number | null>(null)
  // While the user is drag-drawing, this is the live in-progress box.
  // Cleared on mouseup once the box becomes a captured selection.
  const [drawingBox, setDrawingBox] = useState<{
    pageNum: number
    startX: number
    startY: number
    currentX: number
    currentY: number
  } | null>(null)
  const [saving, setSaving] = useState(false)

  // Stable setter — mirror to module-level var (survives remounts) and
  // localStorage (survives page reloads).
  const setStableDoc = useCallback(
    (doc: PolicyDocument) => {
      _savedDocId = doc.id
      writeStoredDocId(model.id, doc.id)
      setSelectedDoc(doc)
    },
    [model.id]
  )

  // Scroll the continuous PDF view to a specific page (1-indexed).
  const scrollToPage = useCallback((page: number) => {
    const wrapper = pageRefs.current.get(page)
    const container = containerRef.current
    if (!wrapper || !container) return
    container.scrollTo({ top: wrapper.offsetTop - 8, behavior: 'auto' })
  }, [])

  // Open a section's popover and scroll its page into view. Used by the
  // popover's prev/next arrows so the user can step through the doc.
  const goToSection = useCallback(
    (s: PolicySection) => {
      setClickedSectionId(s.id)
      if (s.page !== undefined) scrollToPage(s.page)
    },
    [scrollToPage]
  )

  // If there's a pending navigation target, save the doc ID immediately
  // so loadRefs picks it up on first mount
  if (policyTargetDocId) {
    _savedDocId = policyTargetDocId
  }

  // Load references manifest
  const loadRefs = useCallback(() => {
    getReferences(model.id)
      .then((r) => {
        setRefs(r)
        // Doc-id resolution priority: pending navigation → module-level
        // saved (within-session remounts) → localStorage (across reloads)
        // → first PDF doc.
        const targetId = _savedDocId ?? readStoredDocId(model.id) ?? null
        const saved = targetId
          ? r.documents.find((d) => d.id === targetId)
          : null
        const fileDoc = saved ?? r.documents.find((d) => d.file)
        if (fileDoc) {
          _savedDocId = fileDoc.id
          writeStoredDocId(model.id, fileDoc.id)
          setSelectedDoc(fileDoc)
        }
      })
      .catch(() => setRefs(null))
  }, [model.id])

  useEffect(() => {
    loadRefs()
  }, [loadRefs])

  // Navigate to target page when opened from a node reference
  useEffect(() => {
    if (policyTargetPage && policyTargetPage > 0) {
      // Switch to the correct document if specified
      if (policyTargetDocId && refs) {
        const targetDoc = refs.documents.find((d) => d.id === policyTargetDocId)
        if (targetDoc) setStableDoc(targetDoc)
      }
      // Defer the scroll until the page wrapper exists in the DOM. The
      // wrapper appears as soon as numPages is set in onDocumentLoadSuccess,
      // but it may not be there on the first effect tick.
      const tryScroll = () => {
        if (pageRefs.current.has(policyTargetPage)) {
          scrollToPage(policyTargetPage)
        } else {
          requestAnimationFrame(tryScroll)
        }
      }
      tryScroll()
      if (activeSectionId && activeSectionId.length > 0) {
        setClickedSectionId(activeSectionId[0])
      }
      clearPolicyTarget()
    }
  }, [
    policyTargetPage,
    activeSectionId,
    policyTargetDocId,
    refs,
    clearPolicyTarget,
    setStableDoc,
    scrollToPage,
  ])

  // Save scroll position on scroll, restore on mount + on doc switch.
  // The handler is rebound when the active doc changes so the stored
  // scrollTop is keyed by the doc the user is currently looking at.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const docId = selectedDoc?.id ?? null
    // Restore from the per-doc localStorage entry (falls back to the
    // module-level scroll for first-mount-no-doc-yet edge cases).
    if (docId) {
      const saved = readStoredScroll(model.id, docId)
      _savedScrollTop = saved
      container.scrollTop = saved
    } else {
      container.scrollTop = _savedScrollTop
    }
    const handleScroll = () => {
      _savedScrollTop = container.scrollTop
      if (docId) writeStoredScroll(model.id, docId, container.scrollTop)
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [model.id, selectedDoc?.id])

  // Track container width for responsive PDF sizing
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width)
      }
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Virtualization: only mount react-pdf <Page> for pages within ~1 viewport
  // of the visible area. Re-run when numPages changes (new document) so new
  // page wrappers get observed.
  useEffect(() => {
    const root = containerRef.current
    if (!root || numPages === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages((prev) => {
          let changed = false
          const next = new Set(prev)
          for (const entry of entries) {
            const pageNum = Number(
              (entry.target as HTMLDivElement).dataset.page
            )
            if (!Number.isFinite(pageNum)) continue
            if (entry.isIntersecting) {
              if (!next.has(pageNum)) {
                next.add(pageNum)
                changed = true
              }
            } else if (next.has(pageNum)) {
              next.delete(pageNum)
              changed = true
            }
          }
          return changed ? next : prev
        })
      },
      { root, rootMargin: '500px 0px', threshold: 0 }
    )
    for (const el of pageRefs.current.values()) observer.observe(el)
    return () => observer.disconnect()
  }, [numPages])

  // Helper: per-page list of sections (with rects) for the current document.
  const sectionsForPage = useCallback(
    (page: number) =>
      refs?.sections.filter(
        (s) =>
          s.documentId === selectedDoc?.id &&
          s.page === page &&
          s.rects &&
          s.rects.length > 0
      ) ?? [],
    [refs, selectedDoc]
  )

  // Find the page wrapper whose bounding rect contains a given client point.
  // Lets click/selection code work without knowing a single "current page".
  const findPageAt = useCallback((clientX: number, clientY: number) => {
    for (const [pageNum, el] of pageRefs.current) {
      const r = el.getBoundingClientRect()
      if (
        clientX >= r.left &&
        clientX <= r.right &&
        clientY >= r.top &&
        clientY <= r.bottom
      ) {
        return { pageNum, el, rect: r }
      }
    }
    return null
  }, [])

  // Mousedown on a page wrapper starts a box-draw. We deliberately do NOT
  // use the container-level handler / window text-selection: the user wants
  // to draw a rectangle and have us extract the text inside it.
  const handlePageMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, pageNum: number) => {
      // Read-only mode → never start a draw, regardless of the cached
      // mode state (the toolbar is hidden but mode could still be flipped
      // via stale openPolicyForLinking calls).
      if (!ALLOW_WRITES) return
      // Read mode → leave the native text-selection gesture alone so the
      // user can highlight + copy.
      if (mode === 'read') return
      // Skip if the click started on a popover, button, or input — those
      // own their own gestures.
      if (
        (e.target as HTMLElement).closest(
          'button, input, [data-policy-popover]'
        )
      )
        return
      const wrapper = pageRefs.current.get(pageNum)
      if (!wrapper) return
      const rect = wrapper.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const x = (e.clientX - rect.left) / rect.width
      const y = (e.clientY - rect.top) / rect.height
      setDrawingBox({
        pageNum,
        startX: x,
        startY: y,
        currentX: x,
        currentY: y,
      })
      // Suppress browser text selection while we're drawing.
      e.preventDefault()
    },
    [mode]
  )

  // While drawing, follow the cursor on the document; finalize on mouseup.
  useEffect(() => {
    if (!drawingBox) return
    const onMove = (e: MouseEvent) => {
      setDrawingBox((prev) => {
        if (!prev) return null
        const wrapper = pageRefs.current.get(prev.pageNum)
        if (!wrapper) return prev
        const rect = wrapper.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return prev
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
        const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
        return { ...prev, currentX: x, currentY: y }
      })
    }
    const onUp = (e: MouseEvent) => {
      // Snapshot the latest drawingBox via setter, then clear it.
      setDrawingBox((prev) => {
        if (!prev) return null
        finalizeDraw(prev, e)
        return null
      })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawingBox !== null])

  // Escape clears an in-progress draw or a captured selection BEFORE the
  // global Escape handler in use-keyboard-shortcuts (which would close the
  // right panel). Capture-phase listeners on window run before capture-phase
  // listeners on document, so this fires first and we stopPropagation so
  // the global handler doesn't see the keystroke.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (drawingBox) {
        e.stopPropagation()
        e.preventDefault()
        setDrawingBox(null)
      } else if (clickedSectionId) {
        e.stopPropagation()
        e.preventDefault()
        setClickedSectionId(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [drawingBox, clickedSectionId])

  // Hit-test a click against the section overlays on whichever page was
  // clicked. Used both for click handlers (read mode → native click event)
  // and for the tiny-drag fall-through in finalizeDraw.
  const handleSectionClickAt = useCallback(
    (clientX: number, clientY: number) => {
      const hit = findPageAt(clientX, clientY)
      if (!hit) {
        setClickedSectionId(null)
        return
      }
      const nx = (clientX - hit.rect.left) / hit.rect.width
      const ny = (clientY - hit.rect.top) / hit.rect.height
      let hitSection: string | null = null
      for (const section of sectionsForPage(hit.pageNum)) {
        for (const r of section.rects ?? []) {
          if (nx >= r.x && nx <= r.x + r.w && ny >= r.y && ny <= r.y + r.h) {
            hitSection = section.id
            break
          }
        }
        if (hitSection) break
      }
      setClickedSectionId((prev) =>
        hitSection ? (prev === hitSection ? null : hitSection) : null
      )
    },
    [findPageAt, sectionsForPage]
  )

  // onClick on the page wrapper. Browser fires click only when mousedown
  // and mouseup are on the same target without significant drag, so this
  // doesn't fight native text-selection in read mode.
  const handlePageClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Don't handle clicks that originated inside the popover itself.
      if ((e.target as HTMLElement).closest('[data-policy-popover]')) return
      // Suppress the click that follows a successful drag.
      if (justDraggedRef.current) {
        justDraggedRef.current = false
        return
      }
      handleSectionClickAt(e.clientX, e.clientY)
    },
    [handleSectionClickAt]
  )

  const finalizeDraw = (
    box: NonNullable<typeof drawingBox>,
    _e: MouseEvent
  ) => {
    const x0 = Math.min(box.startX, box.currentX)
    const y0 = Math.min(box.startY, box.currentY)
    const w = Math.abs(box.currentX - box.startX)
    const h = Math.abs(box.currentY - box.startY)

    // Tiny box → no save. The browser will dispatch onClick on the page
    // wrapper next, which runs handleSectionClickAt and toggles the popover.
    if (w < 0.005 && h < 0.005) {
      setCapturedRects([])
      setSelectionPage(null)
      return
    }

    const finalBox = { x: x0, y: y0, w, h }
    setClickedSectionId(null)

    if (mode === 'skip') {
      // Quick path: save as skipped immediately. Lets the user keep
      // blasting through skip selections.
      void saveSkippedBox(box.pageNum, finalBox)
      return
    }

    if (mode === 'link') {
      // Save as an unlinked section. The user can click it later to attach
      // nodes / a comment via the popover. If we were opened from a node's
      // '+ link' button, auto-link to that node.
      const autoLink = policyLinkNodePath ? [policyLinkNodePath] : []
      void saveLinkBox(box.pageNum, finalBox, autoLink)
      return
    }
  }

  const onDocumentLoadSuccess = useCallback(
    async (pdf: pdfjs.PDFDocumentProxy) => {
      setError(null)
      pdfDocRef.current = pdf
      // Fetch intrinsic dimensions FIRST so the first render of the page
      // loop reserves the right scroll height (no jank/reflow). Then reveal
      // the pages by setting numPages.
      try {
        const dims = await Promise.all(
          Array.from({ length: pdf.numPages }, async (_, i) => {
            const page = await pdf.getPage(i + 1)
            const viewport = page.getViewport({ scale: 1 })
            return { width: viewport.width, height: viewport.height }
          })
        )
        setPageDimensions(dims)
      } catch {
        // ignore — dimensions aren't strictly required (placeholders fall back)
      }
      setNumPages(pdf.numPages)
      // Restore scroll position after PDF renders. Prefer the per-doc
      // localStorage value over the in-session module fallback; the page
      // wrappers don't exist yet at the start of this callback, so the
      // raF gives them a tick to lay out.
      requestAnimationFrame(() => {
        if (!containerRef.current) return
        const docId = selectedDoc?.id ?? null
        containerRef.current.scrollTop = docId
          ? readStoredScroll(model.id, docId)
          : _savedScrollTop
      })
    },
    [model.id, selectedDoc?.id]
  )

  const onDocumentLoadError = useCallback((err: Error) => {
    setError(err.message)
  }, [])

  // Bumped on every runSearch call so a stale (slow) search whose query is
  // already obsolete doesn't overwrite results from a newer one.
  const searchTokenRef = useRef(0)
  const runSearch = useCallback(
    async (query: string) => {
      const pdf = pdfDocRef.current
      if (!pdf || !query.trim()) {
        setSearchResults([])
        setSearchHighlight('')
        return
      }
      const myToken = ++searchTokenRef.current

      setIsSearching(true)
      const matches: number[] = []
      const q = query.toLowerCase()

      try {
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const textContent = await page.getTextContent()
          const pageText = textContent.items
            .map((item) => ('str' in item ? item.str : ''))
            .join(' ')
            .toLowerCase()
          if (pageText.includes(q)) {
            matches.push(i)
          }
        }
      } catch {
        // ignore search errors
      }

      // Drop stale results — a newer query has been kicked off since.
      if (myToken !== searchTokenRef.current) return
      setSearchResults(matches)
      setSearchIndex(0)
      setSearchHighlight(query.trim())
      if (matches.length > 0) {
        scrollToPage(matches[0])
      }
      setIsSearching(false)
    },
    [scrollToPage]
  )

  // Debounced search-as-you-type. Empty query clears results immediately.
  useEffect(() => {
    if (!searchOpen) return
    if (!searchQuery.trim()) {
      setSearchResults([])
      setSearchHighlight('')
      return
    }
    if (searchHighlight === searchQuery.trim()) return
    const id = setTimeout(() => runSearch(searchQuery), 250)
    return () => clearTimeout(id)
  }, [searchQuery, searchOpen, searchHighlight, runSearch])

  const stepSearch = useCallback(
    (dir: 1 | -1) => {
      if (searchResults.length === 0) return
      const next =
        (searchIndex + dir + searchResults.length) % searchResults.length
      setSearchIndex(next)
      scrollToPage(searchResults[next])
    },
    [searchIndex, searchResults, scrollToPage]
  )

  // ────────────────────────────────────────────────────────────────────
  // Edit existing section box: drag to move, arrow keys to grow/shrink,
  // Delete to remove. We update refs optimistically while editing and
  // persist with a debounce (or on mouseup for drags).
  // ────────────────────────────────────────────────────────────────────
  const [dragState, setDragState] = useState<{
    sectionId: string
    pageNum: number
    startClientX: number
    startClientY: number
    startRect: NormalizedRect
  } | null>(null)
  // Mutable across mousemoves so the drag effect doesn't re-run mid-drag.
  const dragMovedRef = useRef(false)
  // Set on mouseup if the section was actually dragged. Read by
  // handlePageClick to skip the popover-toggle that would otherwise fire.
  const justDraggedRef = useRef(false)

  // Mirror refs in a ref so the debounced saver always sees the latest copy.
  const refsRef = useRef<PolicyReferences | null>(null)
  useEffect(() => {
    refsRef.current = refs
  }, [refs])

  // Mirror page dimensions for the debounced saver (which re-extracts text).
  const pageDimsRef = useRef<{ width: number; height: number }[]>([])
  useEffect(() => {
    pageDimsRef.current = pageDimensions
  }, [pageDimensions])

  // Section IDs whose rect has been edited since the last persist; their
  // captured `text` needs to be re-extracted before saving.
  const dirtyRectsRef = useRef<Set<string>>(new Set())

  const persistRefsDebounced = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const schedulePersist = useCallback(() => {
    if (persistRefsDebounced.current) clearTimeout(persistRefsDebounced.current)
    persistRefsDebounced.current = setTimeout(async () => {
      const r = refsRef.current
      if (!r) return
      // Re-extract text for any sections whose rect was just edited so the
      // saved `text` stays in sync with the current box.
      const dirty = dirtyRectsRef.current
      dirtyRectsRef.current = new Set()
      const pdf = pdfDocRef.current
      let next = r
      if (pdf && dirty.size > 0) {
        const updates = new Map<string, string>()
        for (const sectionId of dirty) {
          const sec = r.sections.find((s) => s.id === sectionId)
          const rect = sec?.rects?.[0]
          if (!sec || !rect || sec.page === undefined) continue
          const dim = pageDimsRef.current[sec.page - 1]
          if (!dim) continue
          const text = await extractTextInBox(pdf, sec.page, dim, rect).catch(
            () => null
          )
          if (typeof text === 'string') updates.set(sectionId, text)
        }
        if (updates.size > 0) {
          next = {
            ...r,
            sections: r.sections.map((s) =>
              updates.has(s.id) ? { ...s, text: updates.get(s.id)! } : s
            ),
          }
          setRefs(next)
        }
      }
      saveReferences(model.id, next).then(() => refreshModel())
    }, 250)
  }, [model.id, refreshModel])

  // Apply a new rect to a section locally (no save). Used by drag and keys.
  const applyRectEdit = useCallback(
    (sectionId: string, rect: NormalizedRect) => {
      dirtyRectsRef.current.add(sectionId)
      setRefs((prev) =>
        prev
          ? {
              ...prev,
              sections: prev.sections.map((s) =>
                s.id === sectionId ? { ...s, rects: [rect] } : s
              ),
            }
          : prev
      )
    },
    []
  )

  // Mousedown on a section overlay rect → maybe-drag.
  const startSectionDrag = (
    e: React.MouseEvent<HTMLDivElement>,
    sectionId: string,
    pageNum: number,
    rect: NormalizedRect
  ) => {
    // Read-only mode: ignore mousedown so the section overlay never drags
    // and the popover-toggle path on plain click still works.
    if (!ALLOW_WRITES) return
    // Don't fight the page wrapper: stop the wrapper's mousedown so it
    // doesn't kick off a brand-new draw. preventDefault stops native
    // text-selection from hijacking the drag in read mode.
    e.stopPropagation()
    e.preventDefault()
    dragMovedRef.current = false
    setDragState({
      sectionId,
      pageNum,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startRect: rect,
    })
  }

  // Drag effect: while a drag is active, follow the cursor; persist on up.
  useEffect(() => {
    if (!dragState) return
    const onMove = (e: MouseEvent) => {
      const wrapper = pageRefs.current.get(dragState.pageNum)
      if (!wrapper) return
      const wrap = wrapper.getBoundingClientRect()
      if (wrap.width === 0 || wrap.height === 0) return
      const dx = (e.clientX - dragState.startClientX) / wrap.width
      const dy = (e.clientY - dragState.startClientY) / wrap.height
      if (
        !dragMovedRef.current &&
        Math.hypot(
          e.clientX - dragState.startClientX,
          e.clientY - dragState.startClientY
        ) > 3
      ) {
        dragMovedRef.current = true
      }
      const r = dragState.startRect
      const next: NormalizedRect = {
        x: Math.max(0, Math.min(1 - r.w, r.x + dx)),
        y: Math.max(0, Math.min(1 - r.h, r.y + dy)),
        w: r.w,
        h: r.h,
      }
      applyRectEdit(dragState.sectionId, next)
    }
    const onUp = () => {
      const moved = dragMovedRef.current
      setDragState(null)
      if (moved) {
        justDraggedRef.current = true
        schedulePersist()
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [dragState, applyRectEdit, schedulePersist])

  // Keyboard editing (arrow keys / Delete) for the currently selected section.
  useEffect(() => {
    if (!clickedSectionId) return
    // Read-only mode: don't bind the editing keys at all.
    if (!ALLOW_WRITES) return
    const STEP = 0.005 // ~half a percent of the page per press
    const onKey = (e: KeyboardEvent) => {
      // Skip when the user is typing in the popover (comment, node search).
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          (t as HTMLElement).isContentEditable)
      )
        return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        e.stopPropagation()
        const r = refsRef.current
        if (!r) return
        const updated: PolicyReferences = {
          ...r,
          sections: r.sections.filter((s) => s.id !== clickedSectionId),
          mappings: r.mappings.filter((m) => m.sectionId !== clickedSectionId),
        }
        setRefs(updated)
        setClickedSectionId(null)
        schedulePersist()
        return
      }

      if (
        e.key !== 'ArrowUp' &&
        e.key !== 'ArrowDown' &&
        e.key !== 'ArrowLeft' &&
        e.key !== 'ArrowRight'
      )
        return

      const r = refsRef.current
      if (!r) return
      const sec = r.sections.find((s) => s.id === clickedSectionId)
      const rect = sec?.rects?.[0]
      if (!rect) return

      e.preventDefault()
      e.stopPropagation()
      const next: NormalizedRect = { ...rect }
      if (e.shiftKey) {
        if (e.key === 'ArrowRight')
          next.x = Math.max(0, Math.min(1 - next.w, next.x + STEP))
        else if (e.key === 'ArrowLeft')
          next.x = Math.max(0, Math.min(1 - next.w, next.x - STEP))
        else if (e.key === 'ArrowDown')
          next.y = Math.max(0, Math.min(1 - next.h, next.y + STEP))
        else if (e.key === 'ArrowUp')
          next.y = Math.max(0, Math.min(1 - next.h, next.y - STEP))
      } else {
        if (e.key === 'ArrowRight')
          next.w = Math.max(0.01, Math.min(1 - next.x, next.w + STEP))
        else if (e.key === 'ArrowLeft') next.w = Math.max(0.01, next.w - STEP)
        else if (e.key === 'ArrowDown')
          next.h = Math.max(0.01, Math.min(1 - next.y, next.h + STEP))
        else if (e.key === 'ArrowUp') next.h = Math.max(0.01, next.h - STEP)
      }
      applyRectEdit(clickedSectionId, next)
      schedulePersist()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clickedSectionId, applyRectEdit, schedulePersist])

  const saveLinkBox = async (
    page: number,
    rect: NormalizedRect,
    autoNodes: string[]
  ) => {
    if (!refs || !selectedDoc) return
    setSaving(true)
    try {
      const pdf = pdfDocRef.current
      const dim = pageDimensions[page - 1]
      const text =
        pdf && dim
          ? await extractTextInBox(pdf, page, dim, rect).catch(() => '')
          : ''
      const sectionId = `${selectedDoc.id}__${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      const updated: PolicyReferences = {
        ...refs,
        sections: [
          ...refs.sections,
          {
            id: sectionId,
            documentId: selectedDoc.id,
            text,
            page,
            rects: [rect],
          },
        ],
        mappings:
          autoNodes.length > 0
            ? [
                ...refs.mappings,
                ...autoNodes.map((nodePath) => ({ nodePath, sectionId })),
              ]
            : refs.mappings,
      }
      await saveReferences(model.id, updated)
      setRefs(updated)
      refreshModel()
      // Open the popover on the new section so the user can immediately
      // tweak it (link nodes, add a comment, resize, etc.).
      setClickedSectionId(sectionId)
      if (autoNodes.length > 0) clearPolicyLinkNode()
    } finally {
      setSaving(false)
    }
  }

  // Replace the linked-node mappings for a single section. Used by the
  // popover's combobox multiselect — every value change autosaves.
  const setSectionMappingsLocal = (sectionId: string, names: string[]) => {
    setRefs((prev) =>
      prev
        ? {
            ...prev,
            mappings: [
              ...prev.mappings.filter((m) => m.sectionId !== sectionId),
              ...names.map((nodePath) => ({ nodePath, sectionId })),
            ],
          }
        : prev
    )
    schedulePersist()
  }

  // Update an existing section's optional comment. Empty string clears.
  const updateSectionComment = async (sectionId: string, comment: string) => {
    if (!refs) return
    const trimmed = comment.trim()
    setSaving(true)
    try {
      const updated: PolicyReferences = {
        ...refs,
        sections: refs.sections.map((s) =>
          s.id === sectionId
            ? { ...s, comment: trimmed === '' ? undefined : trimmed }
            : s
        ),
      }
      await saveReferences(model.id, updated)
      setRefs(updated)
      refreshModel()
    } finally {
      setSaving(false)
    }
  }

  // Save a skipped section directly from a (page, box) without depending on
  // the React state being committed. Used by skip-mode draw, which fires
  // straight from finalizeDraw before setCapturedRects has propagated.
  const saveSkippedBox = async (page: number, rect: NormalizedRect) => {
    if (!refs || !selectedDoc) return
    setSaving(true)
    try {
      const pdf = pdfDocRef.current
      const dim = pageDimensions[page - 1]
      const text =
        pdf && dim
          ? await extractTextInBox(pdf, page, dim, rect).catch(() => '')
          : ''
      const sectionId = `${selectedDoc.id}__skip-${Date.now()}`
      const updated: PolicyReferences = {
        ...refs,
        sections: [
          ...refs.sections,
          {
            id: sectionId,
            documentId: selectedDoc.id,
            text,
            page,
            rects: [rect],
            status: 'skipped',
          },
        ],
      }
      await saveReferences(model.id, updated)
      setRefs(updated)
      refreshModel()
    } finally {
      setSaving(false)
    }
  }

  const handleRemoveSection = async (sectionId: string) => {
    if (!refs) return
    setSaving(true)
    try {
      const updated: PolicyReferences = {
        ...refs,
        sections: refs.sections.filter((s) => s.id !== sectionId),
        mappings: refs.mappings.filter((m) => m.sectionId !== sectionId),
      }
      await saveReferences(model.id, updated)
      setRefs(updated)
      refreshModel()
      setClickedSectionId(null)
    } finally {
      setSaving(false)
    }
  }

  const pdfUrl = selectedDoc?.file
    ? `${API_BASE}/api/rulesets/${model.id}/references/files/${encodeURIComponent(selectedDoc.file)}`
    : null

  const fileDocuments = refs?.documents.filter((d) => d.file) ?? []
  // Pages always render at the panel's natural width (no zoom slider; the
  // user resizes the panel itself to grow/shrink).
  const pageWidth = containerWidth > 0 ? containerWidth - 32 : undefined

  // Search-only text highlighting (still uses customTextRenderer for search)
  const customTextRenderer = useCallback(
    (textItem: { str: string }) => {
      if (!searchHighlight) return textItem.str
      const escaped = searchHighlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = new RegExp(`(${escaped})`, 'gi')
      return textItem.str.replace(
        pattern,
        '<mark style="background: rgba(6, 182, 212, 0.35); color: transparent; mix-blend-mode: multiply;">$1</mark>'
      )
    },
    [searchHighlight]
  )

  // Determine which section IDs are linked to nodes (have at least one mapping)
  const linkedSectionIds = new Set(refs?.mappings.map((m) => m.sectionId) ?? [])

  // Build reverse lookup: section ID → linked node names + IDs
  const sectionToNodes = new Map<string, { id: string; name: string }[]>()
  if (refs) {
    // Build name→id map
    const nameToId = new Map<string, string>()
    for (const [nodeId, node] of Object.entries(model.nodes)) {
      nameToId.set(node.name, nodeId)
    }
    for (const m of refs.mappings) {
      const list = sectionToNodes.get(m.sectionId) ?? []
      const nodeId = nameToId.get(m.nodePath)
      if (nodeId) {
        list.push({ id: nodeId, name: m.nodePath })
      }
      sectionToNodes.set(m.sectionId, list)
    }
  }

  // Sections of the active document in reading order (page → top → left).
  // Drives the popover's prev/next arrows so the user can step through.
  // Sections without a page or rect are skipped — they have no anchor in
  // the PDF view, so navigating to them wouldn't show anything.
  const orderedSections: PolicySection[] =
    !refs || !selectedDoc
      ? []
      : refs.sections
          .filter(
            (s) =>
              s.documentId === selectedDoc.id &&
              s.page !== undefined &&
              (s.rects?.length ?? 0) > 0 &&
              s.status !== 'skipped'
          )
          .slice()
          .sort((a, b) => {
            if ((a.page ?? 0) !== (b.page ?? 0))
              return (a.page ?? 0) - (b.page ?? 0)
            const ar = a.rects?.[0]
            const br = b.rects?.[0]
            if ((ar?.y ?? 0) !== (br?.y ?? 0))
              return (ar?.y ?? 0) - (br?.y ?? 0)
            return (ar?.x ?? 0) - (br?.x ?? 0)
          })
  const currentSectionIndex = clickedSectionId
    ? orderedSections.findIndex((s) => s.id === clickedSectionId)
    : -1
  const prevSection =
    currentSectionIndex > 0 ? orderedSections[currentSectionIndex - 1] : null
  const nextSection =
    currentSectionIndex >= 0 && currentSectionIndex < orderedSections.length - 1
      ? orderedSections[currentSectionIndex + 1]
      : null

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header — title, doc picker, close */}
      <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
        <h2 className="text-sm font-semibold shrink-0">Policy</h2>
        {fileDocuments.length > 0 &&
          (fileDocuments.length === 1 ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-1 min-w-0">
              <FileText className="size-3 shrink-0" />
              <span className="truncate">{fileDocuments[0].title}</span>
            </div>
          ) : (
            <Select
              value={selectedDoc?.id}
              onValueChange={(id) => {
                const doc = fileDocuments.find((d) => d.id === id)
                if (doc) {
                  setStableDoc(doc)
                  if (containerRef.current) containerRef.current.scrollTop = 0
                }
              }}
            >
              <SelectTrigger className="flex-1 min-w-0">
                <SelectValue placeholder="Select a document..." />
              </SelectTrigger>
              <SelectContent>
                {fileDocuments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 ml-auto shrink-0"
          onClick={() => setRightBar(null)}
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* Mode toolbar + collapsible search on the same row */}
      {pdfUrl && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b shrink-0">
          {ALLOW_WRITES && (
            <ButtonGroup>
              {(['read', 'link', 'skip'] as const).map((m) => (
                <Button
                  key={m}
                  size="sm"
                  variant={mode === m ? 'default' : 'outline'}
                  className="h-7 text-[11px] capitalize"
                  onClick={() => setMode(m)}
                >
                  {m}
                </Button>
              ))}
            </ButtonGroup>
          )}
          {/* Section navigation — step through the document's anchored
              sections in reading order. With nothing selected, prev/next
              jump to the last/first section so the user can start
              browsing without clicking on the PDF first. Yields the row
              entirely when search is open so the input has full width. */}
          {orderedSections.length > 0 && !searchOpen && (
            <div className="flex items-center gap-0.5 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                disabled={currentSectionIndex === 0}
                onClick={() => {
                  const target =
                    currentSectionIndex < 0
                      ? orderedSections[orderedSections.length - 1]
                      : prevSection
                  if (target) goToSection(target)
                }}
                title="Previous section"
              >
                <ChevronLeft className="size-3" />
              </Button>
              <span className="text-[10px] text-muted-foreground tabular-nums px-0.5 min-w-[2.5rem] text-center">
                {currentSectionIndex >= 0
                  ? `${currentSectionIndex + 1}/${orderedSections.length}`
                  : `${orderedSections.length}`}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                disabled={currentSectionIndex === orderedSections.length - 1}
                onClick={() => {
                  const target =
                    currentSectionIndex < 0 ? orderedSections[0] : nextSection
                  if (target) goToSection(target)
                }}
                title="Next section"
              >
                <ChevronRight className="size-3" />
              </Button>
            </div>
          )}
          {searchOpen ? (
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <Search className="size-3 text-muted-foreground shrink-0" />
              <input
                autoFocus
                className="flex-1 h-6 text-xs bg-transparent border-b border-input focus:border-foreground outline-none min-w-0 transition-colors"
                placeholder="Search PDF..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    stepSearch(e.shiftKey ? -1 : 1)
                  } else if (e.key === 'Escape') {
                    setSearchOpen(false)
                  }
                }}
              />
              {isSearching && (
                <span className="text-[10px] text-muted-foreground shrink-0">
                  searching…
                </span>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                disabled={searchResults.length === 0}
                onClick={() => stepSearch(-1)}
                title="Previous match (Shift+Enter)"
              >
                <ChevronLeft className="size-3" />
              </Button>
              {searchResults.length > 0 && (
                <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                  {searchIndex + 1}/{searchResults.length}
                </span>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                disabled={searchResults.length === 0}
                onClick={() => stepSearch(1)}
                title="Next match (Enter)"
              >
                <ChevronRight className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => {
                  setSearchOpen(false)
                  setSearchQuery('')
                  setSearchResults([])
                  setSearchHighlight('')
                }}
              >
                <X className="size-3" />
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 ml-auto shrink-0"
              onClick={() => setSearchOpen(true)}
              title="Search"
            >
              <Search className="size-3.5" />
            </Button>
          )}
        </div>
      )}

      {/* Linking mode banner — shown when opened from a node's "+" button.
          Each link-mode draw auto-attaches to this node until cleared. */}
      {policyLinkNodePath && (
        <div className="px-4 py-2 border-b bg-violet-50 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-violet-800">
              Drag a box to link to{' '}
              <span className="font-mono font-semibold">
                {policyLinkNodePath}
              </span>
            </p>
            <button
              className="p-0.5 text-violet-600 hover:text-violet-800"
              onClick={clearPolicyLinkNode}
            >
              <X className="size-3" />
            </button>
          </div>
        </div>
      )}

      {/* PDF content */}
      <div ref={containerRef} className="flex-1 overflow-auto px-4 py-2">
        {!refs ? (
          <p className="text-sm text-muted-foreground text-center mt-8">
            Loading...
          </p>
        ) : fileDocuments.length === 0 ? (
          <div className="text-center mt-8">
            <p className="text-sm text-muted-foreground">
              No policy documents with files attached.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Add a file path to a document in references.json to view it here.
            </p>
          </div>
        ) : error ? (
          <div className="text-center mt-8">
            <p className="text-sm text-red-600">Failed to load PDF</p>
            <p className="text-xs text-muted-foreground mt-1">{error}</p>
          </div>
        ) : pdfUrl ? (
          <Document
            file={pdfUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={
              <p className="text-sm text-muted-foreground text-center mt-8">
                Loading PDF...
              </p>
            }
          >
            <div className="flex flex-col items-center gap-2">
              {Array.from({ length: numPages }, (_, i) => {
                const pageNum = i + 1
                const dim = pageDimensions[i]
                const aspect = dim ? dim.height / dim.width : 11 / 8.5
                const w = pageWidth ?? 0
                const placeholderHeight = w * aspect
                const inView = visiblePages.has(pageNum)
                const pageSections = sectionsForPage(pageNum)
                return (
                  <div
                    key={pageNum}
                    ref={(el) => {
                      if (el) pageRefs.current.set(pageNum, el)
                      else pageRefs.current.delete(pageNum)
                    }}
                    data-page={pageNum}
                    className={cn(
                      'relative bg-white shadow-sm',
                      mode !== 'read' && 'select-none'
                    )}
                    style={{
                      width: w || undefined,
                      minHeight: placeholderHeight || undefined,
                    }}
                    onMouseDown={(e) => handlePageMouseDown(e, pageNum)}
                    onClick={handlePageClick}
                  >
                    {inView && pageWidth && (
                      <Page
                        pageNumber={pageNum}
                        width={pageWidth}
                        renderAnnotationLayer
                        renderTextLayer
                        customTextRenderer={
                          searchHighlight ? customTextRenderer : undefined
                        }
                      />
                    )}
                    {/* Bounding box overlays for sections on this page */}
                    {pageSections.map((section) => {
                      const isClicked = section.id === clickedSectionId
                      const isSkipped = section.status === 'skipped'
                      const isLinked = linkedSectionIds.has(section.id)

                      // Orphans (unlinked, non-skipped) are rendered in rose with
                      // a dashed border so they read as "needs attention" without
                      // looking like an error. Linked sections stay amber, skipped
                      // gray, and the selected section overrides everything in blue.
                      let bg: string
                      if (isClicked) {
                        bg = 'rgba(59, 130, 246, 0.25)' // blue
                      } else if (isSkipped) {
                        bg = 'rgba(156, 163, 175, 0.25)' // gray
                      } else if (isLinked) {
                        bg = 'rgba(251, 191, 36, 0.2)' // amber
                      } else {
                        bg = 'rgba(244, 63, 94, 0.18)' // rose — orphan
                      }

                      const border =
                        isClicked
                          ? '1px solid rgba(59, 130, 246, 0.5)'
                          : isSkipped
                            ? '1px solid rgba(156, 163, 175, 0.3)'
                            : !isLinked
                              ? '1px dashed rgba(244, 63, 94, 0.55)'
                              : undefined

                      const linkedNodes = sectionToNodes.get(section.id) ?? []

                      return (
                        <div key={section.id}>
                          {/* Highlight rects. Sit above react-pdf's TextLayer
                        (z-index 2) and AnnotationLayer (z-index 3) so
                        mousedown lands on us, not the text layer. */}
                          {(section.rects ?? []).map((rect, i) => (
                            <div
                              key={`${section.id}-${i}`}
                              className="absolute"
                              style={{
                                left: `${rect.x * 100}%`,
                                top: `${rect.y * 100}%`,
                                width: `${rect.w * 100}%`,
                                height: `${rect.h * 100}%`,
                                background: bg,
                                border,
                                zIndex: 10,
                                cursor: isClicked ? 'move' : 'pointer',
                              }}
                              onMouseDown={(e) =>
                                startSectionDrag(e, section.id, pageNum, rect)
                              }
                            />
                          ))}
                          {/* Popover — opens on click; portaled to body and
                        clamped to viewport so it stays on screen even when
                        the section is huge. */}
                          {isClicked &&
                            section.rects &&
                            section.rects.length > 0 && (
                              <SectionPopover
                                section={section}
                                pageWrapper={
                                  pageRefs.current.get(pageNum) ?? null
                                }
                                editable={ALLOW_WRITES}
                                isSkipped={isSkipped}
                                linkedNames={linkedNodes.map((n) => n.name)}
                                onLinkedNamesChange={(names) =>
                                  setSectionMappingsLocal(section.id, names)
                                }
                                onCommentChange={(c) =>
                                  updateSectionComment(section.id, c)
                                }
                                onRemove={() => handleRemoveSection(section.id)}
                                onClose={() => setClickedSectionId(null)}
                                onOpenNode={(name) => {
                                  const id = Object.entries(model.nodes).find(
                                    ([, n]) => n.name === name
                                  )?.[0]
                                  if (id) {
                                    setOpenNode(id)
                                    setClickedSectionId(null)
                                  }
                                }}
                                nodeOptions={Object.values(model.nodes).map(
                                  (n) => ({
                                    name: n.name,
                                  })
                                )}
                                openNodeName={
                                  openNode
                                    ? model.nodes[openNode]?.name
                                    : undefined
                                }
                                saving={saving}
                                alreadyInTaskBuilder={(attachTarget.kind ===
                                'follow-up'
                                  ? (followUpSources[attachTarget.threadId] ??
                                    [])
                                  : taskBuilderSources
                                ).some((s) => s.sectionId === section.id)}
                                onUseInTaskBuilder={() => {
                                  // Add is idempotent on duplicates; routing matches
                                  // the current attach target so follow-up composes
                                  // get their own source bag instead of polluting
                                  // the new-task builder.
                                  if (attachTarget.kind === 'follow-up') {
                                    addFollowUpSource(attachTarget.threadId, {
                                      sectionId: section.id,
                                    })
                                  } else {
                                    addTaskBuilderSource({
                                      sectionId: section.id,
                                    })
                                  }
                                  setClickedSectionId(null)
                                  setRightBar('tasks')
                                }}
                              />
                            )}
                        </div>
                      )
                    })}
                    {/* Captured-selection preview (after a draw, before save) */}
                    {selectionPage === pageNum &&
                      capturedRects.map((rect, i) => (
                        <div
                          key={`preview-${i}`}
                          className="absolute pointer-events-none"
                          style={{
                            left: `${rect.x * 100}%`,
                            top: `${rect.y * 100}%`,
                            width: `${rect.w * 100}%`,
                            height: `${rect.h * 100}%`,
                            background: 'rgba(34, 197, 94, 0.25)',
                            border: '1px solid rgba(34, 197, 94, 0.6)',
                            zIndex: 2,
                          }}
                        />
                      ))}
                    {/* Live drag-in-progress rectangle */}
                    {drawingBox &&
                      drawingBox.pageNum === pageNum &&
                      (() => {
                        const x = Math.min(
                          drawingBox.startX,
                          drawingBox.currentX
                        )
                        const y = Math.min(
                          drawingBox.startY,
                          drawingBox.currentY
                        )
                        const wRel = Math.abs(
                          drawingBox.currentX - drawingBox.startX
                        )
                        const hRel = Math.abs(
                          drawingBox.currentY - drawingBox.startY
                        )
                        return (
                          <div
                            className="absolute pointer-events-none"
                            style={{
                              left: `${x * 100}%`,
                              top: `${y * 100}%`,
                              width: `${wRel * 100}%`,
                              height: `${hRel * 100}%`,
                              background: 'rgba(59, 130, 246, 0.18)',
                              border: '1px dashed rgba(59, 130, 246, 0.7)',
                              zIndex: 3,
                            }}
                          />
                        )
                      })()}
                  </div>
                )
              })}
            </div>
          </Document>
        ) : null}
      </div>
    </div>
  )
}
