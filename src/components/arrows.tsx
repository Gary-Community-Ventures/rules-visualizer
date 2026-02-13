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

function Arrow({
  fromId,
  toId,
  rows,
  scale,
  strokeWidth,
  parentMap,
}: ArrowProps) {
  const { model, hoveredNodeId, showChildren } = useMainContext()
  const nodes = model.nodes
  const [path, setPath] = useState<string>('')
  const [isDashed, setIsDashed] = useState(false)
  const [color] = useState('#001970')

  // Arrow is related if nothing is hovered, or if it directly connects to the hovered node
  const isRelated =
    hoveredNodeId === null || fromId === hoveredNodeId || toId === hoveredNodeId

  // Get all visible node IDs from rows
  const visibleNodeIds = rows.flat()

  // Check if both nodes are visible
  const isFromVisible = visibleNodeIds.includes(fromId)
  const isToVisible = visibleNodeIds.includes(toId)

  // Don't show arrow if parent isn't showing children
  const parentShowsChildren = showChildren[fromId] ?? false

  useEffect(() => {
    const updateArrow = () => {
      if (!isFromVisible || !isToVisible || !parentShowsChildren) {
        setPath('')
        return
      }

      const fromElement = document.getElementById(nodeElementId(fromId))
      const toElement = document.getElementById(nodeElementId(toId))

      if (!fromElement || !toElement) {
        return
      }

      const fromRect = fromElement.getBoundingClientRect()
      const toRect = toElement.getBoundingClientRect()

      const fromX = fromRect.left + fromRect.width / 2
      const fromY = fromRect.top + fromRect.height

      // Stagger the toX based on how many parents point to this node
      const toParents = parentMap[toId] ?? []
      const depIndex = toParents.indexOf(fromId)
      const totalDeps = toParents.length
      const staggerWidth = 5
      const staggerStep = totalDeps > 1 ? staggerWidth / (totalDeps - 1) : 0
      const toXOffset =
        totalDeps > 1 ? depIndex * staggerStep - staggerWidth / 2 : 0

      const toX = toRect.left + toRect.width / 2 + toXOffset
      const toY = toRect.top

      // Find which row each node is in the filtered rows
      let fromRowIndex = -1
      let toRowIndex = -1
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].includes(fromId)) fromRowIndex = i
        if (rows[i].includes(toId)) toRowIndex = i
      }

      // Check if rows are adjacent in the filtered view
      const isAdjacent = Math.abs(toRowIndex - fromRowIndex) === 1

      let pathData: string
      if (isAdjacent) {
        // Adjacent rows (or no visible rows in between) - use elbows with staggered midpoints based on target node
        const verticalDistance = toY - fromY

        // Find the index of the fromId node within its row (source-based stagger)
        const fromNodeIndex = rows[fromRowIndex].indexOf(fromId)
        const totalNodesInFromRow = rows[fromRowIndex].length

        // Calculate stagger offset: spread across 70% of the vertical distance
        const staggerRange = verticalDistance * 0.7
        const staggerStep = staggerRange / (totalNodesInFromRow + 1)
        const staggerOffset =
          staggerStep * (fromNodeIndex + 1) - staggerRange / 2

        // Midpoint with stagger
        const midY = fromY + verticalDistance * 0.5 + staggerOffset

        // Elbow path: down to staggered midpoint, across, then down to target
        pathData = `M ${fromX} ${fromY} V ${midY} H ${toX} V ${toY}`
        setIsDashed(false)
      } else {
        // Multiple visible rows in between - use straight line, dashed
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
    visibleNodeIds,
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
      opacity={isRelated ? 1 : 0.2}
      style={
        isHoverAnimated ? { animation: 'flow 0.5s linear infinite' } : undefined
      }
    />
  )
}

type ArrowsProps = {
  rows: string[][]
}

/** Build a map: nodeId -> list of parent nodeIds that depend on it */
function buildParentMap(nodes: ModelNodes): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const [nodeId, node] of Object.entries(nodes)) {
    for (const depId of node.dependencies) {
      if (!map[depId]) map[depId] = []
      map[depId].push(nodeId)
    }
  }
  return map
}

export function Arrows({ rows }: ArrowsProps) {
  const { model } = useMainContext()
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

  // Pre-compute parent map once when nodes change (O(N) instead of O(N²) per arrow)
  const parentMap = useMemo(() => buildParentMap(nodes), [nodes])

  // Collect all arrows: from parent node down to its dependencies
  const arrows: { fromId: string; toId: string }[] = []

  for (const [nodeId, node] of Object.entries(nodes)) {
    for (const depId of node.dependencies) {
      arrows.push({ fromId: nodeId, toId: depId })
    }
  }

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
      {arrows.map(({ fromId, toId }) => (
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
