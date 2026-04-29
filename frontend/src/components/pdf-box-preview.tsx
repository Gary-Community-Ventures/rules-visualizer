import { useEffect, useRef, useState } from 'react'
import { pdfjs } from 'react-pdf'
import type { NormalizedRect } from '@/lib/model'

// Scale to render the cached source page at. Bumped past 1× so a fill-width
// preview in a moderately wide panel still has more source pixels than
// display pixels (no upscale blur for typical panel widths up to ~1200 css
// px on a non-retina display).
const PREVIEW_RENDER_SCALE = 2

// One PDFDocumentProxy promise per pdfUrl, shared across all preview
// instances on the page. Keeps us from loading the same PDF twice.
const docCache = new Map<string, Promise<pdfjs.PDFDocumentProxy>>()
// One rendered canvas per (pdfUrl, pageNum), for cropping.
const pageCanvasCache = new Map<string, HTMLCanvasElement>()
const pageCanvasInflight = new Map<string, Promise<HTMLCanvasElement | null>>()

function pageKey(pdfUrl: string, pageNum: number): string {
  return `${pdfUrl}::${pageNum}`
}

async function getPageCanvas(
  pdfUrl: string,
  pageNum: number
): Promise<HTMLCanvasElement | null> {
  const key = pageKey(pdfUrl, pageNum)
  const cached = pageCanvasCache.get(key)
  if (cached) return cached
  const inflight = pageCanvasInflight.get(key)
  if (inflight) return inflight
  const promise = (async () => {
    let docPromise = docCache.get(pdfUrl)
    if (!docPromise) {
      docPromise = pdfjs.getDocument(pdfUrl).promise
      docCache.set(pdfUrl, docPromise)
    }
    const pdf = await docPromise
    const page = await pdf.getPage(pageNum)
    const viewport = page.getViewport({ scale: PREVIEW_RENDER_SCALE })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvas, viewport }).promise
    pageCanvasCache.set(key, canvas)
    pageCanvasInflight.delete(key)
    return canvas
  })()
  pageCanvasInflight.set(key, promise)
  return promise
}

/**
 * Renders the contents of a normalized rectangle on a PDF page as a canvas
 * image, sized to fill the parent's width. Self-contained: loads the PDF
 * and renders the page on its own (cached across instances).
 */
export function PdfBoxPreview({
  pdfUrl,
  pageNum,
  box,
  className,
}: {
  pdfUrl: string
  pageNum: number
  box: NormalizedRect
  className?: string
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [wrapperWidth, setWrapperWidth] = useState(0)

  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWrapperWidth(entry.contentRect.width)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (wrapperWidth === 0) return
    let cancelled = false
    getPageCanvas(pdfUrl, pageNum).then((src) => {
      if (cancelled || !src || !canvasRef.current) return
      const sx = box.x * src.width
      const sy = box.y * src.height
      const sw = Math.max(1, box.w * src.width)
      const sh = Math.max(1, box.h * src.height)
      const dpr = window.devicePixelRatio || 1
      const cssW = wrapperWidth
      const cssH = (sh / sw) * cssW
      const target = canvasRef.current
      target.width = Math.max(1, Math.round(cssW * dpr))
      target.height = Math.max(1, Math.round(cssH * dpr))
      target.style.width = `${cssW}px`
      target.style.height = `${cssH}px`
      const ctx = target.getContext('2d')
      if (!ctx) return
      ctx.drawImage(src, sx, sy, sw, sh, 0, 0, target.width, target.height)
    })
    return () => {
      cancelled = true
    }
  }, [pdfUrl, pageNum, box, wrapperWidth])

  return (
    <div ref={wrapperRef} className="w-full">
      <canvas ref={canvasRef} className={className} />
    </div>
  )
}
