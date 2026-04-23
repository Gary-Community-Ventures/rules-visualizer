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
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  FileText,
  Link,
  X,
  Check,
  Search,
} from 'lucide-react'

// Configure pdf.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

const API_BASE = import.meta.env.VITE_API_URL ?? ''

// Module-level stores — survive component remounts from refreshModel()
let _savedPage = 1
let _savedScale = 1.0
let _savedScrollTop = 0
let _savedDocId: string | null = null

/**
 * Capture the current browser selection's bounding rects,
 * normalized to 0-1 coordinates relative to the page container.
 * Merges rects on the same line into full-width bands for clean highlighting.
 */
function captureSelectionRects(pageEl: HTMLElement | null): NormalizedRect[] {
  if (!pageEl) return []
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return []

  const pageRect = pageEl.getBoundingClientRect()
  if (pageRect.width === 0 || pageRect.height === 0) return []

  // Collect all raw rects
  const rawRects: {
    top: number
    bottom: number
    left: number
    right: number
  }[] = []
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i)
    const clientRects = range.getClientRects()
    for (let j = 0; j < clientRects.length; j++) {
      const r = clientRects[j]
      if (r.width < 2 || r.height < 2) continue
      if (r.right < pageRect.left || r.left > pageRect.right) continue
      rawRects.push({
        top: r.top - pageRect.top,
        bottom: r.bottom - pageRect.top,
        left: r.left - pageRect.left,
        right: r.right - pageRect.left,
      })
    }
  }

  if (rawRects.length === 0) return []

  // Merge rects on the same line (similar y position) into full-width bands
  // Sort by top position
  rawRects.sort((a, b) => a.top - b.top)

  const lines: { top: number; bottom: number; left: number; right: number }[] =
    []
  let current = { ...rawRects[0] }

  for (let i = 1; i < rawRects.length; i++) {
    const r = rawRects[i]
    // Same line if vertical overlap > 50% of the smaller height
    const overlap =
      Math.min(current.bottom, r.bottom) - Math.max(current.top, r.top)
    const minH = Math.min(current.bottom - current.top, r.bottom - r.top)
    if (overlap > minH * 0.5) {
      // Merge into current line
      current.top = Math.min(current.top, r.top)
      current.bottom = Math.max(current.bottom, r.bottom)
      current.left = Math.min(current.left, r.left)
      current.right = Math.max(current.right, r.right)
    } else {
      lines.push(current)
      current = { ...r }
    }
  }
  lines.push(current)

  // Add small horizontal padding and normalize to 0-1
  const pad = pageRect.width * 0.01
  return lines.map((line) => ({
    x: Math.max(0, line.left - pad) / pageRect.width,
    y: line.top / pageRect.height,
    w: Math.min(1, (line.right - line.left + pad * 2) / pageRect.width),
    h: (line.bottom - line.top) / pageRect.height,
  }))
}

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
  } = useMainContext()
  const [refs, setRefs] = useState<PolicyReferences | null>(null)
  const [selectedDoc, setSelectedDoc] = useState<PolicyDocument | null>(null)
  const [numPages, setNumPages] = useState<number>(0)
  const [pageNumber, setPageNumber] = useState(1)
  const [scale, setScaleRaw] = useState(_savedScale)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
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

  // Selection capture state
  const [selectedText, setSelectedText] = useState('')
  const [capturedRects, setCapturedRects] = useState<NormalizedRect[]>([])
  const [showLinkForm, setShowLinkForm] = useState(false)
  const [sectionLabel, setSectionLabel] = useState('')
  const [selectedNodePaths, setSelectedNodePaths] = useState<string[]>([])
  const [nodeSearch, setNodeSearch] = useState('')
  const [saving, setSaving] = useState(false)

  // Stable setters — write to module-level vars so state survives remounts
  const setStableDoc = useCallback((doc: PolicyDocument) => {
    _savedDocId = doc.id
    setSelectedDoc(doc)
  }, [])

  const setStableScale = useCallback((s: number) => {
    _savedScale = s
    setScaleRaw(s)
  }, [])

  const setStablePage = useCallback((page: number) => {
    _savedPage = page
    setPageNumber(page)
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
        const targetDoc = refs.documents.find(
          (d) => d.id === policyTargetDocId
        )
        if (targetDoc) setStableDoc(targetDoc)
      }
      setStablePage(policyTargetPage)
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
    setStablePage,
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

  // Gather sections that have rects on the current page
  const currentPageSections =
    refs?.sections.filter(
      (s) =>
        s.documentId === selectedDoc?.id &&
        s.page === pageNumber &&
        s.rects &&
        s.rects.length > 0
    ) ?? []

  // Listen for text selection and overlay clicks in the PDF area
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleMouseDown = (e: MouseEvent) => {
      mouseDownPos.current = { x: e.clientX, y: e.clientY }
    }

    const handleMouseUp = (e: MouseEvent) => {
      // Ignore events inside popovers
      if ((e.target as HTMLElement).closest('[data-policy-popover]')) return

      const selection = window.getSelection()
      const text = selection?.toString().trim()

      // Check if this was a click (not a drag) — detect overlay hit
      const downPos = mouseDownPos.current
      const isClick =
        downPos &&
        Math.abs(e.clientX - downPos.x) < 5 &&
        Math.abs(e.clientY - downPos.y) < 5

      if (text && text.length > 10) {
        // Text selection — capture it
        setSelectedText(text)
        setCapturedRects(captureSelectionRects(pageRef.current))
        setClickedSectionId(null)
      } else {
        // No meaningful selection — clear the selection bar
        if (!showLinkForm) {
          setSelectedText('')
          setCapturedRects([])
        }

        // Click without selection — check if we hit an overlay rect
        if (isClick && pageRef.current) {
          const pageRect = pageRef.current.getBoundingClientRect()
          const nx = (e.clientX - pageRect.left) / pageRect.width
          const ny = (e.clientY - pageRect.top) / pageRect.height

          let hitSection: string | null = null
          for (const section of currentPageSections) {
            for (const rect of section.rects ?? []) {
              if (
                nx >= rect.x &&
                nx <= rect.x + rect.w &&
                ny >= rect.y &&
                ny <= rect.y + rect.h
              ) {
                hitSection = section.id
                break
              }
            }
            if (hitSection) break
          }

          if (hitSection) {
            setClickedSectionId((prev) =>
              prev === hitSection ? null : hitSection
            )
          } else {
            setClickedSectionId(null)
          }
        }
      }

      mouseDownPos.current = null
    }

    container.addEventListener('mousedown', handleMouseDown)
    container.addEventListener('mouseup', handleMouseUp)
    return () => {
      container.removeEventListener('mousedown', handleMouseDown)
      container.removeEventListener('mouseup', handleMouseUp)
    }
  }, [currentPageSections])

  const onDocumentLoadSuccess = useCallback((pdf: { numPages: number }) => {
    setNumPages(pdf.numPages)
    // Restore the page from module-level store (survives component remounts)
    setPageNumber(_savedPage)
    setError(null)
    pdfDocRef.current = pdf as unknown as pdfjs.PDFDocumentProxy
    // Restore scroll position after PDF renders
    requestAnimationFrame(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop = _savedScrollTop
      }
    })
  }, [])

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
      setStablePage(matches[0])
    }
    setIsSearching(false)
  }, [])

  const startLinking = () => {
    setShowLinkForm(true)
    setSectionLabel('')
    setSelectedNodePaths(policyLinkNodePath ? [policyLinkNodePath] : [])
    setNodeSearch('')
  }

  const cancelLinking = () => {
    setShowLinkForm(false)
    setSelectedText('')
    setCapturedRects([])
    setSelectedNodePaths([])
    clearPolicyLinkNode()
    window.getSelection()?.removeAllRanges()
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
      selectedNodePaths.length === 0
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
            text: selectedText,
            page: pageNumber,
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
    if (!refs || !selectedDoc || !selectedText) return
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
            text: selectedText,
            page: pageNumber,
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
  const pageWidth =
    containerWidth > 0 ? (containerWidth - 32) * scale : undefined

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
                    setStablePage(searchResults[nextIdx])
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
                  setStablePage(1)
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

      {/* Controls */}
      {pdfUrl && numPages > 0 && (
        <div className="flex items-center justify-between px-4 py-1.5 border-b shrink-0">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-6"
              onClick={() => setStablePage(Math.max(1, pageNumber - 1))}
              disabled={pageNumber <= 1}
            >
              <ChevronLeft className="size-3" />
            </Button>
            <span className="text-xs text-muted-foreground px-1">
              {pageNumber} / {numPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-6"
              onClick={() => setStablePage(Math.min(numPages, pageNumber + 1))}
              disabled={pageNumber >= numPages}
            >
              <ChevronRight className="size-3" />
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-6"
              onClick={() => setStableScale(Math.max(0.5, scale - 0.15))}
              disabled={scale <= 0.5}
            >
              <ZoomOut className="size-3" />
            </Button>
            <span className="text-xs text-muted-foreground px-1">
              {Math.round(scale * 100)}%
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-6"
              onClick={() => setStableScale(Math.min(3, scale + 0.15))}
              disabled={scale >= 3}
            >
              <ZoomIn className="size-3" />
            </Button>
          </div>
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
      {selectedText && !showLinkForm && (
        <div className="px-4 py-2 border-b bg-blue-50 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-blue-800 truncate flex-1">
              Selected: &ldquo;{selectedText.slice(0, 80)}
              {selectedText.length > 80 ? '...' : ''}&rdquo;
            </p>
            <div className="flex gap-1 shrink-0">
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

          <div className="text-[11px] text-muted-foreground bg-background border rounded p-2 max-h-20 overflow-y-auto whitespace-pre-wrap">
            {selectedText}
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
            <div ref={pageRef} className="relative inline-block">
              <Page
                pageNumber={pageNumber}
                width={pageWidth}
                renderAnnotationLayer
                renderTextLayer
                customTextRenderer={
                  searchHighlight ? customTextRenderer : undefined
                }
              />
              {/* Bounding box overlays for sections on this page */}
              {currentPageSections.map((section) => {
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
              {/* Green preview overlay for current selection while link form is open */}
              {showLinkForm &&
                capturedRects.map((rect, i) => (
                  <div
                    key={`preview-${i}`}
                    className="absolute pointer-events-none"
                    style={{
                      left: `${rect.x * 100}%`,
                      top: `${rect.y * 100}%`,
                      width: `${rect.w * 100}%`,
                      height: `${rect.h * 100}%`,
                      background: 'rgba(34, 197, 94, 0.3)',
                      border: '1px solid rgba(34, 197, 94, 0.6)',
                      zIndex: 1,
                    }}
                  />
                ))}
            </div>
          </Document>
        ) : null}
      </div>
    </div>
  )
}
