import { useState, useEffect, useCallback, useRef } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { useMainContext } from '@/context'
import { getNodePath } from '@/context/model-context'
import { getReferences, saveReferences } from '@/lib/api/rules-api'
import type {
  PolicyDocument,
  PolicyReferences,
  NormalizedRect,
} from '@/lib/model'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { FileText, Link, X, Check, Search } from 'lucide-react'

// Configure pdf.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

const API_BASE = import.meta.env.VITE_API_URL ?? ''

// Module-level stores — survive component remounts from refreshModel()
let _savedScrollTop = 0
let _savedDocId: string | null = null

export function PolicyPanel() {
  const {
    model,
    refreshModel,
    policyTargetPage,
    policyFocusSectionIds: activeSectionId,
    policyTargetDocId,
    clearPolicyTarget,
    setOpenNode,
    policyLinkNodePath,
    clearPolicyLinkNode,
    setRightBar,
  } = useMainContext()
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
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<number[]>([])
  const [searchIndex, setSearchIndex] = useState(0)
  const [isSearching, setIsSearching] = useState(false)
  const [searchHighlight, setSearchHighlight] = useState('')
  const pdfDocRef = useRef<pdfjs.PDFDocumentProxy | null>(null)

  // The section ID to highlight with a blue overlay (from node link navigation)
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null)
  // Clicked section in the PDF — shows linked nodes popover
  const [clickedSectionId, setClickedSectionId] = useState<string | null>(null)
  // Adding nodes to an existing section (reuse the node picker UI)
  const [addingToSectionId, setAddingToSectionId] = useState<string | null>(
    null
  )

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
  const [showLinkForm, setShowLinkForm] = useState(false)
  const [sectionLabel, setSectionLabel] = useState('')
  const [selectedNodePaths, setSelectedNodePaths] = useState<string[]>([])
  const [nodeSearch, setNodeSearch] = useState('')
  const [saving, setSaving] = useState(false)

  // Stable setter — write to module-level var so state survives remounts
  const setStableDoc = useCallback((doc: PolicyDocument) => {
    _savedDocId = doc.id
    setSelectedDoc(doc)
  }, [])

  // Scroll the continuous PDF view to a specific page (1-indexed).
  const scrollToPage = useCallback((page: number) => {
    const wrapper = pageRefs.current.get(page)
    const container = containerRef.current
    if (!wrapper || !container) return
    container.scrollTo({ top: wrapper.offsetTop - 8, behavior: 'auto' })
  }, [])

  // Build node path list for the picker
  const allNodes: { path: string; name: string; label?: string }[] = []
  for (const node of Object.values(model.nodes)) {
    const path = getNodePath(node.content)
    if (!path) continue
    const label =
      node.content.type !== 'entity'
        ? (node.content as { label?: string }).label
        : undefined
    allNodes.push({ path, name: node.name, label })
  }

  const filteredNodes = nodeSearch
    ? allNodes.filter(
        (n) =>
          n.name.toLowerCase().includes(nodeSearch.toLowerCase()) ||
          n.path.toLowerCase().includes(nodeSearch.toLowerCase()) ||
          (n.label?.toLowerCase().includes(nodeSearch.toLowerCase()) ?? false)
      )
    : allNodes

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
        // Restore saved document (may have been set by pending navigation)
        const targetId = _savedDocId
        const saved = targetId
          ? r.documents.find((d) => d.id === targetId)
          : null
        const fileDoc = saved ?? r.documents.find((d) => d.file)
        if (fileDoc) {
          _savedDocId = fileDoc.id
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
        setFocusedSectionId(activeSectionId[0])
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

  // Save scroll position on scroll, restore on mount
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    // Restore saved scroll position
    container.scrollTop = _savedScrollTop
    const handleScroll = () => {
      _savedScrollTop = container.scrollTop
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

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
  const findPageAt = useCallback(
    (clientX: number, clientY: number) => {
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
    },
    []
  )

  // Mousedown on a page wrapper starts a box-draw. We deliberately do NOT
  // use the container-level handler / window text-selection: the user wants
  // to draw a rectangle and have us extract the text inside it.
  const handlePageMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, pageNum: number) => {
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
    []
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
        const x = Math.max(
          0,
          Math.min(1, (e.clientX - rect.left) / rect.width)
        )
        const y = Math.max(
          0,
          Math.min(1, (e.clientY - rect.top) / rect.height)
        )
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
      if (drawingBox || capturedRects.length > 0) {
        e.stopPropagation()
        e.preventDefault()
        setDrawingBox(null)
        setCapturedRects([])
        setSelectionPage(null)
        // If the link form is open, close that too.
        if (showLinkForm) {
          setShowLinkForm(false)
          setSelectedNodePaths([])
          clearPolicyLinkNode()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [drawingBox, capturedRects.length, showLinkForm, clearPolicyLinkNode])

  const finalizeDraw = (
    box: NonNullable<typeof drawingBox>,
    e: MouseEvent
  ) => {
    const x0 = Math.min(box.startX, box.currentX)
    const y0 = Math.min(box.startY, box.currentY)
    const w = Math.abs(box.currentX - box.startX)
    const h = Math.abs(box.currentY - box.startY)

    // Tiny box → treat as a click (hit-test existing section overlays).
    if (w < 0.005 && h < 0.005) {
      const hit = findPageAt(e.clientX, e.clientY)
      if (hit) {
        const nx = (e.clientX - hit.rect.left) / hit.rect.width
        const ny = (e.clientY - hit.rect.top) / hit.rect.height
        let hitSection: string | null = null
        for (const section of sectionsForPage(hit.pageNum)) {
          for (const r of section.rects ?? []) {
            if (
              nx >= r.x &&
              nx <= r.x + r.w &&
              ny >= r.y &&
              ny <= r.y + r.h
            ) {
              hitSection = section.id
              break
            }
          }
          if (hitSection) break
        }
        setClickedSectionId((prev) =>
          hitSection ? (prev === hitSection ? null : hitSection) : null
        )
      } else {
        setClickedSectionId(null)
      }
      // Clear any leftover capture state if we weren't in the middle of saving.
      if (!showLinkForm) {
        setCapturedRects([])
        setSelectionPage(null)
      }
      return
    }

    setCapturedRects([{ x: x0, y: y0, w, h }])
    setSelectionPage(box.pageNum)
    setClickedSectionId(null)
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
      // Restore scroll position after PDF renders
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = _savedScrollTop
        }
      })
    },
    []
  )

  const onDocumentLoadError = useCallback((err: Error) => {
    setError(err.message)
  }, [])

  const runSearch = useCallback(async (query: string) => {
    const pdf = pdfDocRef.current
    if (!pdf || !query.trim()) {
      setSearchResults([])
      setSearchHighlight('')
      return
    }

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

    setSearchResults(matches)
    setSearchIndex(0)
    setSearchHighlight(query.trim())
    if (matches.length > 0) {
      scrollToPage(matches[0])
    }
    setIsSearching(false)
  }, [scrollToPage])

  const startLinking = () => {
    setShowLinkForm(true)
    setSectionLabel('')
    setSelectedNodePaths(policyLinkNodePath ? [policyLinkNodePath] : [])
    setNodeSearch('')
  }

  const cancelLinking = () => {
    setShowLinkForm(false)
    setCapturedRects([])
    setSelectionPage(null)
    setSelectedNodePaths([])
    clearPolicyLinkNode()
  }

  const toggleNodePath = (path: string) => {
    setSelectedNodePaths((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    )
  }

  const handleSave = async () => {
    if (
      !refs ||
      !selectedDoc ||
      !sectionLabel.trim() ||
      selectedNodePaths.length === 0 ||
      selectionPage === null
    )
      return
    setSaving(true)
    try {
      const sectionId = `${selectedDoc.id}__${sectionLabel
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9.]+/g, '-')}`

      const updated: PolicyReferences = {
        documents: [...refs.documents],
        sections: [
          ...refs.sections,
          {
            id: sectionId,
            documentId: selectedDoc.id,
            label: sectionLabel.trim(),
            page: selectionPage,
            rects: capturedRects.length > 0 ? capturedRects : undefined,
          },
        ],
        mappings: [
          ...refs.mappings,
          ...selectedNodePaths.map((nodePath) => ({ nodePath, sectionId })),
        ],
      }

      await saveReferences(model.id, updated)
      setRefs(updated)
      refreshModel()
      cancelLinking()
    } finally {
      setSaving(false)
    }
  }

  const handleSkip = async () => {
    if (!refs || !selectedDoc || selectionPage === null) return
    setSaving(true)
    try {
      const sectionId = `${selectedDoc.id}__skip-${Date.now()}`
      const updated: PolicyReferences = {
        ...refs,
        sections: [
          ...refs.sections,
          {
            id: sectionId,
            documentId: selectedDoc.id,
            label: 'Skipped',
            page: selectionPage,
            rects: capturedRects.length > 0 ? capturedRects : undefined,
            status: 'skipped',
          },
        ],
      }
      await saveReferences(model.id, updated)
      setRefs(updated)
      refreshModel()
      cancelLinking()
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

  const handleAddNodesToSection = async (sectionId: string) => {
    if (!refs || selectedNodePaths.length === 0) return
    setSaving(true)
    try {
      const existing = new Set(
        refs.mappings
          .filter((m) => m.sectionId === sectionId)
          .map((m) => m.nodePath)
      )
      const newMappings = selectedNodePaths
        .filter((p) => !existing.has(p))
        .map((nodePath) => ({ nodePath, sectionId }))

      const updated: PolicyReferences = {
        ...refs,
        mappings: [...refs.mappings, ...newMappings],
      }
      await saveReferences(model.id, updated)
      setRefs(updated)
      refreshModel()
      setAddingToSectionId(null)
      setSelectedNodePaths([])
      setNodeSearch('')
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

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
        <h2 className="text-sm font-semibold shrink-0">Policy</h2>
        {pdfUrl && (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <Search className="size-3 text-muted-foreground shrink-0" />
            <input
              className="flex-1 h-6 text-xs bg-transparent border-b border-transparent focus:border-foreground outline-none min-w-0"
              placeholder="Search PDF..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                if (!e.target.value) {
                  setSearchResults([])
                  setSearchHighlight('')
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (
                    searchResults.length > 0 &&
                    searchHighlight === searchQuery
                  ) {
                    // Same query — cycle through results
                    const nextIdx = (searchIndex + 1) % searchResults.length
                    setSearchIndex(nextIdx)
                    scrollToPage(searchResults[nextIdx])
                  } else {
                    // New query — run fresh search
                    runSearch(searchQuery)
                  }
                }
              }}
            />
            {searchResults.length > 0 && (
              <span className="text-[10px] text-muted-foreground shrink-0">
                {searchIndex + 1}/{searchResults.length}
              </span>
            )}
            {isSearching && (
              <span className="text-[10px] text-muted-foreground shrink-0">
                searching...
              </span>
            )}
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 ml-auto shrink-0"
          onClick={() => setRightBar(null)}
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* Document selector */}
      {fileDocuments.length > 0 && (
        <div className="px-4 py-2 border-b shrink-0">
          {fileDocuments.length === 1 ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileText className="size-3" />
              <span className="truncate">{fileDocuments[0].title}</span>
            </div>
          ) : (
            <select
              className="w-full h-7 text-xs border rounded px-2 bg-background"
              value={selectedDoc?.id ?? ''}
              onChange={(e) => {
                const doc = fileDocuments.find((d) => d.id === e.target.value)
                if (doc) {
                  setStableDoc(doc)
                  if (containerRef.current) containerRef.current.scrollTop = 0
                }
              }}
            >
              {fileDocuments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Linking mode banner — shown when opened from a node's "+" button */}
      {policyLinkNodePath && !showLinkForm && (
        <div className="px-4 py-2 border-b bg-violet-50 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-violet-800">
              Select text to link to{' '}
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

      {/* Selection capture bar */}
      {selectionPage !== null && capturedRects[0] && !showLinkForm && (
        <div className="px-4 py-2 border-b bg-blue-50 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-blue-800">
              Captured selection on page {selectionPage}
            </span>
            <div className="flex gap-1 shrink-0 ml-auto">
              <Button
                size="sm"
                className="h-6 text-[11px] gap-1"
                onClick={startLinking}
              >
                <Link className="size-3" />
                Link to nodes
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[11px] gap-1"
                onClick={handleSkip}
                disabled={saving}
              >
                Skip
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[11px]"
                onClick={cancelLinking}
              >
                <X className="size-3" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Link form */}
      {showLinkForm && (
        <div className="px-4 py-3 border-b bg-muted/30 shrink-0 space-y-2 max-h-[50%] overflow-y-auto">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">Create policy section</span>
            <button
              className="p-0.5 text-muted-foreground hover:text-foreground"
              onClick={cancelLinking}
            >
              <X className="size-3.5" />
            </button>
          </div>

          <Input
            className="h-7 text-xs"
            placeholder="Section label (e.g. 4.407.2 — Earned Income Deduction)"
            value={sectionLabel}
            onChange={(e) => setSectionLabel(e.target.value)}
            autoFocus
          />

          <div>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase">
              Link to nodes
            </span>
            {selectedNodePaths.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {selectedNodePaths.map((p) => (
                  <span
                    key={p}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-100 text-blue-800 text-[10px] rounded cursor-pointer hover:bg-blue-200"
                    onClick={() => toggleNodePath(p)}
                  >
                    {p}
                    <X className="size-2.5" />
                  </span>
                ))}
              </div>
            )}
            <Input
              className="h-7 text-xs mt-1"
              placeholder="Search nodes..."
              value={nodeSearch}
              onChange={(e) => setNodeSearch(e.target.value)}
            />
            {nodeSearch && (
              <div className="border rounded mt-1 max-h-32 overflow-y-auto bg-background">
                {filteredNodes.slice(0, 20).map((n) => {
                  const isSelected = selectedNodePaths.includes(n.name)
                  return (
                    <button
                      key={n.path}
                      className={`w-full text-left px-2 py-1 text-xs hover:bg-muted flex items-center gap-1.5 ${isSelected ? 'bg-blue-50' : ''}`}
                      onClick={() => {
                        toggleNodePath(n.name)
                        setNodeSearch('')
                      }}
                    >
                      {isSelected && (
                        <Check className="size-3 text-blue-600 shrink-0" />
                      )}
                      <span className="font-mono text-[11px] truncate">
                        {n.name}
                      </span>
                      {n.label && (
                        <span className="text-muted-foreground truncate">
                          {n.label}
                        </span>
                      )}
                    </button>
                  )
                })}
                {filteredNodes.length === 0 && (
                  <p className="px-2 py-1 text-xs text-muted-foreground">
                    No matching nodes
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-1.5 justify-end pt-1">
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[11px]"
              onClick={cancelLinking}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-6 text-[11px]"
              onClick={handleSave}
              disabled={
                saving || !sectionLabel.trim() || selectedNodePaths.length === 0
              }
            >
              {saving ? 'Saving...' : 'Save section'}
            </Button>
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
              className="relative bg-white shadow-sm select-none"
              style={{
                width: w || undefined,
                minHeight: placeholderHeight || undefined,
              }}
              onMouseDown={(e) => handlePageMouseDown(e, pageNum)}
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
                const isFocused = section.id === focusedSectionId
                const isClicked = section.id === clickedSectionId
                const isSkipped = section.status === 'skipped'
                const isLinked = linkedSectionIds.has(section.id)

                let bg: string
                if (isFocused || isClicked) {
                  bg = 'rgba(59, 130, 246, 0.25)' // blue
                } else if (isSkipped) {
                  bg = 'rgba(156, 163, 175, 0.25)' // gray
                } else if (isLinked) {
                  bg = 'rgba(251, 191, 36, 0.2)' // amber
                } else {
                  bg = 'rgba(251, 191, 36, 0.15)' // light amber
                }

                const border =
                  isFocused || isClicked
                    ? '1px solid rgba(59, 130, 246, 0.5)'
                    : isSkipped
                      ? '1px solid rgba(156, 163, 175, 0.3)'
                      : undefined

                const linkedNodes = sectionToNodes.get(section.id) ?? []

                return (
                  <div key={section.id}>
                    {/* Highlight rects */}
                    {(section.rects ?? []).map((rect, i) => (
                      <div
                        key={`${section.id}-${i}`}
                        className="absolute pointer-events-none"
                        style={{
                          left: `${rect.x * 100}%`,
                          top: `${rect.y * 100}%`,
                          width: `${rect.w * 100}%`,
                          height: `${rect.h * 100}%`,
                          background: bg,
                          border,
                          zIndex: 1,
                        }}
                      />
                    ))}
                    {/* Popover showing linked nodes */}
                    {isClicked && section.rects && section.rects.length > 0 && (
                      <div
                        data-policy-popover
                        className="absolute z-20 bg-popover border rounded-md shadow-lg p-2 min-w-[200px]"
                        style={{
                          left: `${section.rects[0].x * 100}%`,
                          top: `${(section.rects[section.rects.length - 1].y + section.rects[section.rects.length - 1].h) * 100}%`,
                          marginTop: 4,
                        }}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-xs font-semibold truncate">
                            {section.label}
                          </span>
                          <button
                            className="p-0.5 text-muted-foreground hover:text-foreground shrink-0"
                            onClick={() => setClickedSectionId(null)}
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                        {isSkipped ? (
                          <div className="space-y-1">
                            <p className="text-[10px] text-muted-foreground italic">
                              Marked as not relevant
                            </p>
                            <button
                              className="text-[10px] text-red-600 hover:underline"
                              onClick={() => handleRemoveSection(section.id)}
                              disabled={saving}
                            >
                              Remove marking
                            </button>
                          </div>
                        ) : linkedNodes.length > 0 ? (
                          <div className="space-y-0.5">
                            <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                              Linked nodes
                            </span>
                            {linkedNodes.map((n) => (
                              <button
                                key={n.id}
                                className="block w-full text-left text-xs font-mono text-violet-700 hover:underline px-1 py-0.5 rounded hover:bg-muted"
                                onClick={() => {
                                  setOpenNode(n.id)
                                  setClickedSectionId(null)
                                }}
                              >
                                {n.name}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[10px] text-muted-foreground italic">
                            No nodes linked
                          </p>
                        )}

                        {/* Add more nodes (only for non-skipped sections) */}
                        {!isSkipped && addingToSectionId === section.id ? (
                          <div className="mt-2 pt-2 border-t space-y-1">
                            {selectedNodePaths.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {selectedNodePaths.map((p) => (
                                  <span
                                    key={p}
                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-100 text-blue-800 text-[10px] rounded cursor-pointer hover:bg-blue-200"
                                    onClick={() => toggleNodePath(p)}
                                  >
                                    {p}
                                    <X className="size-2.5" />
                                  </span>
                                ))}
                              </div>
                            )}
                            <Input
                              className="h-6 text-xs"
                              placeholder="Search nodes..."
                              value={nodeSearch}
                              onChange={(e) => setNodeSearch(e.target.value)}
                              autoFocus
                            />
                            {nodeSearch && (
                              <div className="border rounded max-h-24 overflow-y-auto bg-background">
                                {filteredNodes.slice(0, 15).map((n) => {
                                  const isSel = selectedNodePaths.includes(
                                    n.name
                                  )
                                  return (
                                    <button
                                      key={n.path}
                                      className={`w-full text-left px-2 py-0.5 text-[11px] hover:bg-muted flex items-center gap-1 ${isSel ? 'bg-blue-50' : ''}`}
                                      onClick={() => {
                                        toggleNodePath(n.name)
                                        setNodeSearch('')
                                      }}
                                    >
                                      {isSel && (
                                        <Check className="size-2.5 text-blue-600 shrink-0" />
                                      )}
                                      <span className="font-mono truncate">
                                        {n.name}
                                      </span>
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                            <div className="flex gap-1 justify-end">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-5 text-[10px]"
                                onClick={() => {
                                  setAddingToSectionId(null)
                                  setSelectedNodePaths([])
                                  setNodeSearch('')
                                }}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                className="h-5 text-[10px]"
                                onClick={() =>
                                  handleAddNodesToSection(section.id)
                                }
                                disabled={
                                  saving || selectedNodePaths.length === 0
                                }
                              >
                                {saving ? '...' : 'Add'}
                              </Button>
                            </div>
                          </div>
                        ) : !isSkipped && !addingToSectionId ? (
                          <div className="flex items-center gap-2 mt-1.5">
                            <button
                              className="text-[10px] text-blue-600 hover:underline"
                              onClick={() => {
                                setAddingToSectionId(section.id)
                                setSelectedNodePaths([])
                                setNodeSearch('')
                              }}
                            >
                              + Link more nodes
                            </button>
                            <button
                              className="text-[10px] text-red-500 hover:underline"
                              onClick={() => handleRemoveSection(section.id)}
                              disabled={saving}
                            >
                              Remove
                            </button>
                          </div>
                        ) : null}
                      </div>
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
              {drawingBox && drawingBox.pageNum === pageNum && (() => {
                const x = Math.min(drawingBox.startX, drawingBox.currentX)
                const y = Math.min(drawingBox.startY, drawingBox.currentY)
                const wRel = Math.abs(drawingBox.currentX - drawingBox.startX)
                const hRel = Math.abs(drawingBox.currentY - drawingBox.startY)
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
