import { useEffect, useMemo, useState } from 'react'
import { useMainContext } from '@/context'
import { nodeElementId } from './node'
import type { ModelNodes } from '@/lib/model'

type ArrowProps = {
  fromId: string
  toId: string
  rows: string[][]
  scale: number
  strokeWidth: number
  parentMap: Record<string, string[]>
}

const COLORS = { active: '#001970', inactive: '#c0c0d8' }

function Arrow({
  fromId,
  toId,
  rows,
  scale,
  strokeWidth,
  parentMap,
}: ArrowProps) {
  const { model, hoveredNodeId, openNode, showChildren } = useMainContext()
  const nodes = model.nodes
  const [path, setPath] = useState<string>('')
  const [isDashed, setIsDashed] = useState(false)

  const activeNode = hoveredNodeId ?? openNode
  const isRelated =
    activeNode === null || fromId === activeNode || toId === activeNode
  const color = isRelated ? COLORS.active : COLORS.inactive

  const visibleNodeIds = useMemo(() => rows.flat(), [rows])

  const isFromVisible = visibleNodeIds.includes(fromId)
  const isToVisible = visibleNodeIds.includes(toId)

  const parentShowsChildren = showChildren[fromId] === true

  useEffect(() => {
    const updateArrow = () => {
      if (!isFromVisible || !isToVisible || !parentShowsChildren) {
        setPath('')
        return
      }

      const fromElement = document.getElementById(nodeElementId(fromId))
      const toElement = document.getElementById(nodeElementId(toId))

      if (!fromElement || !toElement) {
        setPath('')
        return
      }

      const fromRect = fromElement.getBoundingClientRect()
      const toRect = toElement.getBoundingClientRect()

      // Skip if elements haven't been laid out yet (returns 0,0 during initial render)
      if (fromRect.width === 0 || toRect.width === 0) {
        setPath('')
        return
      }

      const fromX = fromRect.left + fromRect.width / 2
      const fromY = fromRect.top + fromRect.height

      const toParents = parentMap[toId] ?? []
      const depIndex = toParents.indexOf(fromId)
      const totalDeps = toParents.length
      const gapPerArrow = 6
      const maxStaggerWidth = Math.min(toRect.width * 0.5, 30)
      const toStaggerWidth = Math.min(
        (totalDeps - 1) * gapPerArrow,
        maxStaggerWidth
      )
      const toStaggerStep = totalDeps > 1 ? toStaggerWidth / (totalDeps - 1) : 0
      const toXOffset =
        totalDeps > 1 ? depIndex * toStaggerStep - toStaggerWidth / 2 : 0

      const toX = toRect.left + toRect.width / 2 + toXOffset
      const toY = toRect.top

      let fromRowIndex = -1
      let toRowIndex = -1
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].includes(fromId)) fromRowIndex = i
        if (rows[i].includes(toId)) toRowIndex = i
      }

      const isAdjacent = Math.abs(toRowIndex - fromRowIndex) === 1

      let pathData: string
      if (isAdjacent) {
        const verticalDistance = toY - fromY

        const fromNodeIndex = rows[fromRowIndex].indexOf(fromId)
        const totalNodesInFromRow = rows[fromRowIndex].length

        const staggerRange = verticalDistance * 0.7
        const staggerStep = staggerRange / (totalNodesInFromRow + 1)
        const staggerOffset =
          staggerStep * (fromNodeIndex + 1) - staggerRange / 2

        const midY = fromY + verticalDistance * 0.5 + staggerOffset

        pathData = `M ${fromX} ${fromY} V ${midY} H ${toX} V ${toY}`
        setIsDashed(false)
      } else {
        pathData = `M ${fromX} ${fromY} L ${toX} ${toY}`
        setIsDashed(true)
      }

      setPath(pathData)
    }

    updateArrow()

    window.addEventListener('resize', updateArrow)
    window.addEventListener('transform', updateArrow)
    window.addEventListener('containerresize', updateArrow)

    return () => {
      window.removeEventListener('resize', updateArrow)
      window.removeEventListener('transform', updateArrow)
      window.removeEventListener('containerresize', updateArrow)
    }
  }, [
    fromId,
    toId,
    rows,
    nodes,
    isFromVisible,
    isToVisible,
    parentShowsChildren,
    scale,
    parentMap,
  ])

  if (!path) {
    return null
  }

  const isHoverAnimated = isRelated && hoveredNodeId !== null

  const dashSize = 8 * scale

  return (
    <path
      d={path}
      stroke={color}
      strokeWidth={strokeWidth}
      fill="none"
      strokeDasharray={
        isDashed || isHoverAnimated ? `${dashSize},${dashSize}` : undefined
      }
      style={
        isHoverAnimated ? { animation: 'flow 0.5s linear infinite' } : undefined
      }
    />
  )
}

type ArrowsProps = {
  rows: string[][]
}

function buildParentMap(nodes: ModelNodes): Record<string, string[]> {
  const map: Record<string, string[]> = {}

  for (const [nodeId, node] of Object.entries(nodes)) {
    for (const depId of node.dependencies) {
      if (!map[depId]) map[depId] = []
      if (!map[depId].includes(nodeId)) map[depId].push(nodeId)
    }
  }

  return map
}

export function Arrows({ rows }: ArrowsProps) {
  const { model, hoveredNodeId } = useMainContext()
  const nodes = model.nodes
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const handleTransform = (e: CustomEvent<{ scale: number }>) => {
      setScale(e.detail.scale)
    }
    window.addEventListener('transform', handleTransform as EventListener)
    return () =>
      window.removeEventListener('transform', handleTransform as EventListener)
  }, [])

  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      window.dispatchEvent(new Event('containerresize'))
    })
    return () => cancelAnimationFrame(frameId)
  }, [nodes])

  const parentMap = useMemo(() => buildParentMap(nodes), [nodes])

  const arrows = useMemo(() => {
    const result: { fromId: string; toId: string }[] = []

    for (const [nodeId, node] of Object.entries(nodes)) {
      for (const depId of node.dependencies) {
        result.push({ fromId: nodeId, toId: depId })
      }
    }

    return result
  }, [nodes])

  const sortedArrows = useMemo(() => {
    return [...arrows].sort((a, b) => {
      const aRelated =
        hoveredNodeId === null ||
        a.fromId === hoveredNodeId ||
        a.toId === hoveredNodeId
      const bRelated =
        hoveredNodeId === null ||
        b.fromId === hoveredNodeId ||
        b.toId === hoveredNodeId
      return aRelated === bRelated ? 0 : aRelated ? 1 : -1
    })
  }, [arrows, hoveredNodeId])

  const strokeWidth = 2 * scale

  return (
    <svg
      className="fixed top-0 left-0 w-full h-full pointer-events-none"
      style={{ zIndex: -1 }}
    >
      <style>
        {`
          @keyframes flow {
            from { stroke-dashoffset: 0; }
            to { stroke-dashoffset: ${16 * scale}; }
          }
        `}
      </style>
      {sortedArrows.map(({ fromId, toId }) => (
        <Arrow
          key={`${fromId}-${toId}`}
          fromId={fromId}
          toId={toId}
          rows={rows}
          scale={scale}
          strokeWidth={strokeWidth}
          parentMap={parentMap}
        />
      ))}
    </svg>
  )
}
