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
  const dragStart = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only pan with left mouse button
    if (e.button !== 0) return

    // Skip panning when clicking on interactive elements
    if ((e.target as HTMLElement).closest('button, input, [data-no-pan]'))
      return

    setIsPanning(true)
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return

    const deltaX = e.clientX - dragStart.current.x
    const deltaY = e.clientY - dragStart.current.y

    setOffset({
      x: dragStart.current.offsetX + deltaX,
      y: dragStart.current.offsetY + deltaY,
    })
  }

  const handleMouseUp = () => {
    setIsPanning(false)
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

  // Handle mouse leaving container or releasing outside
  useEffect(() => {
    const handleGlobalMouseUp = () => setIsPanning(false)
    window.addEventListener('mouseup', handleGlobalMouseUp)
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp)
  }, [])

  // Add wheel listener with { passive: false } to allow preventDefault
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()

      const rect = container.getBoundingClientRect()

      // Mouse position relative to container
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      // Calculate new scale
      const delta = -e.deltaY * ZOOM_SENSITIVITY
      const newScale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, scale * (1 + delta))
      )

      // Adjust offset to zoom towards mouse position
      const scaleRatio = newScale / scale
      const newOffsetX = mouseX - (mouseX - offset.x) * scaleRatio
      const newOffsetY = mouseY - (mouseY - offset.y) * scaleRatio

      setScale(newScale)
      setOffset({ x: newOffsetX, y: newOffsetY })
    }

    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [scale, offset])

  // Dispatch event when transform changes so arrows recalculate
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('transform', { detail: { scale } }))
  }, [scale, offset])

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
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <div
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
        className="absolute bottom-4 right-4 shadow-sm"
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
