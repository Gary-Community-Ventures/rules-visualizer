import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { ButtonGroup } from './ui/button-group'
import { Minus, Plus, RotateCcw } from 'lucide-react'

type PanContainerProps = {
  children: React.ReactNode
  className?: string
}

const MIN_SCALE = 0.1
const MAX_SCALE = 3
const ZOOM_SENSITIVITY = 0.001
const ZOOM_STEP = 0.2

export function PanContainer({ children, className }: PanContainerProps) {
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [scale, setScale] = useState(1)
  const [isPanning, setIsPanning] = useState(false)
  // Active pan-to-element animation frame, so we can cancel it if the
  // user starts panning or another pan-to fires mid-flight.
  const animFrameRef = useRef<number | null>(null)
  const dragStart = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // Keep transform values in refs so the wheel handler always sees the
  // freshest scale/offset — without these, a pan-mousemove and a wheel
  // event interleaving in the same frame race against React state and
  // produce glitchy jumps.
  const scaleRef = useRef(scale)
  const offsetRef = useRef(offset)
  scaleRef.current = scale
  offsetRef.current = offset

  // Track total drag distance so we can suppress the click event that would
  // otherwise fire after a pan. If the mouse moved more than DRAG_THRESHOLD
  // pixels between mousedown and mouseup, we treat it as a pan and stop the
  // resulting click from reaching child onClick handlers (e.g. node clicks).
  const DRAG_THRESHOLD = 5
  const draggedRef = useRef(false)

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only pan with left mouse button
    if (e.button !== 0) return

    // Skip panning when clicking on interactive elements
    if ((e.target as HTMLElement).closest('button, input, [data-no-pan]'))
      return

    // User started panning — cancel any in-flight pan-to animation so the
    // canvas tracks the cursor exactly instead of fighting the easing.
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
    draggedRef.current = false
    setIsPanning(true)
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
    }
  }

  const handleClickCapture = (e: React.MouseEvent) => {
    // If the user dragged before releasing, swallow the click so it doesn't
    // open whatever node happened to be under the cursor.
    if (draggedRef.current) {
      e.stopPropagation()
      e.preventDefault()
      draggedRef.current = false
    }
  }

  const zoomIn = () => {
    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const centerX = rect.width / 2
    const centerY = rect.height / 2

    const newScale = Math.min(MAX_SCALE, scale + ZOOM_STEP)
    const scaleRatio = newScale / scale
    const newOffsetX = centerX - (centerX - offset.x) * scaleRatio
    const newOffsetY = centerY - (centerY - offset.y) * scaleRatio

    setScale(newScale)
    setOffset({ x: newOffsetX, y: newOffsetY })
  }

  const zoomOut = () => {
    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const centerX = rect.width / 2
    const centerY = rect.height / 2

    const newScale = Math.max(MIN_SCALE, scale - ZOOM_STEP)
    const scaleRatio = newScale / scale
    const newOffsetX = centerX - (centerX - offset.x) * scaleRatio
    const newOffsetY = centerY - (centerY - offset.y) * scaleRatio

    setScale(newScale)
    setOffset({ x: newOffsetX, y: newOffsetY })
  }

  const resetView = () => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }

  useEffect(() => {
    if (!isPanning) return
    const onMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStart.current.x
      const deltaY = e.clientY - dragStart.current.y
      if (
        !draggedRef.current &&
        Math.abs(deltaX) + Math.abs(deltaY) > DRAG_THRESHOLD
      ) {
        draggedRef.current = true
      }
      setOffset({
        x: dragStart.current.offsetX + deltaX,
        y: dragStart.current.offsetY + deltaY,
      })
    }
    const onUp = () => setIsPanning(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isPanning])

  // Wheel handler — registered once, reads scale/offset through refs so
  // there's no stale-closure race when pan-mousemove and wheel events
  // interleave (which is what made drag+pinch jumpy on trackpads).
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()

      const rect = container.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      const prevScale = scaleRef.current
      const prevOffset = offsetRef.current
      const delta = -e.deltaY * ZOOM_SENSITIVITY
      const newScale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, prevScale * (1 + delta))
      )
      if (newScale === prevScale) return
      const scaleRatio = newScale / prevScale
      setScale(newScale)
      setOffset({
        x: mouseX - (mouseX - prevOffset.x) * scaleRatio,
        y: mouseY - (mouseY - prevOffset.y) * scaleRatio,
      })
    }

    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [])

  // Dispatch event when transform changes so arrows recalculate
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('transform', { detail: { scale } }))
  }, [scale, offset])

  // External "pan to element" event — used by useAddToFilter (and future
  // callers) to bring a node into view, anchored at the top-middle of the
  // container. JS-driven rAF animation (rather than CSS transition) so
  // we don't have to fight React's commit batching when toggling the
  // transition style and the new transform value at the same time.
  useEffect(() => {
    const TOP_PADDING = 80
    const DURATION_MS = 500
    // ease-out cubic — fast start, gentle settle.
    const ease = (t: number) => 1 - Math.pow(1 - t, 3)
    const onPanTo = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { elementId?: string }
        | undefined
      const elId = detail?.elementId
      if (!elId) return
      const el = document.getElementById(elId)
      const container = containerRef.current
      if (!el || !container) return
      const elRect = el.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      // Element's current screen position relative to the container —
      // already includes the current scale + offset transform.
      const elCenterX = (elRect.left + elRect.right) / 2 - containerRect.left
      const elTopY = elRect.top - containerRect.top
      // Back out the element's natural (untransformed) position. Inverse
      // of `screen = natural * scale + offset`.
      const startScale = scaleRef.current
      const startOffset = { ...offsetRef.current }
      const naturalX = (elCenterX - startOffset.x) / startScale
      const naturalY = (elTopY - startOffset.y) / startScale
      // Recompute the offset that puts the element at the target screen
      // position at scale = 1.
      const targetX = containerRect.width / 2
      const targetY = TOP_PADDING
      const targetScale = 1
      const targetOffset = {
        x: targetX - naturalX,
        y: targetY - naturalY,
      }

      // Cancel any prior animation so they don't fight.
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current)
      }
      const startTime = performance.now()
      const tick = (now: number) => {
        const elapsed = now - startTime
        const t = Math.min(elapsed / DURATION_MS, 1)
        const k = ease(t)
        setScale(startScale + (targetScale - startScale) * k)
        setOffset({
          x: startOffset.x + (targetOffset.x - startOffset.x) * k,
          y: startOffset.y + (targetOffset.y - startOffset.y) * k,
        })
        if (t < 1) {
          animFrameRef.current = requestAnimationFrame(tick)
        } else {
          animFrameRef.current = null
          // Pulse the target so the user's eye lands on it. Re-add the
          // class on each pan-to so repeated dispatches restart the
          // animation (toggle-off then -on next frame to reset state).
          el.classList.remove('pan-target-pulse')
          // Force a reflow so the browser registers the class removal
          // before re-adding — required to restart a CSS keyframe anim.
          void el.offsetWidth
          el.classList.add('pan-target-pulse')
          window.setTimeout(() => {
            el.classList.remove('pan-target-pulse')
          }, 3300)
        }
      }
      animFrameRef.current = requestAnimationFrame(tick)
    }
    window.addEventListener('pan-to-element', onPanTo)
    return () => {
      window.removeEventListener('pan-to-element', onPanTo)
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current)
        animFrameRef.current = null
      }
    }
  }, [])

  // Watch for size changes — fires when:
  //   - Tab goes from display:none (0×0) to visible (outer container)
  //   - Window/panel resizes (outer container)
  //   - Content grows because nodes expanded, e.g. after a test/execution
  //     added a result badge (inner container)
  // Keeps arrows and virtualization in sync.
  useEffect(() => {
    const outer = containerRef.current
    const inner = contentRef.current
    if (!outer || !inner) return
    const observer = new ResizeObserver(() => {
      window.dispatchEvent(new Event('containerresize'))
    })
    observer.observe(outer)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={containerRef}
      data-pan-container
      className={cn(
        'relative overflow-hidden flex-1 z-[3]',
        isPanning ? 'cursor-grabbing select-none' : 'cursor-grab',
        className
      )}
      onMouseDown={handleMouseDown}
      onClickCapture={handleClickCapture}
    >
      <div
        ref={contentRef}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: '0 0',
          willChange: isPanning ? 'transform' : 'auto',
        }}
      >
        {children}
      </div>

      {/* Zoom controls */}
      <ButtonGroup
        orientation="vertical"
        className="absolute bottom-4 right-4 rounded-md shadow-sm"
      >
        <Button
          variant="outline"
          size="icon"
          onClick={zoomIn}
          data-no-pan
          className="h-8 w-8"
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={resetView}
          data-no-pan
          className="h-8 w-8"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={zoomOut}
          data-no-pan
          className="h-8 w-8"
        >
          <Minus className="h-4 w-4" />
        </Button>
      </ButtonGroup>
    </div>
  )
}
