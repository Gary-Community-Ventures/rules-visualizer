import { useEffect, useMemo, useState } from 'react'
import { useMainContext } from '@/context'
import { nodeElementId } from './node'
import type { ModelNode, ModelNodes } from '@/lib/model'

type ArrowStatus = 'normal' | 'added' | 'removed' | 'to-new' | 'to-deleted'

type ArrowProps = {
  fromId: string
  toId: string
  rows: string[][]
  scale: number
  strokeWidth: number
  parentMap: Record<string, string[]>
  status: ArrowStatus
}

const STATUS_COLORS: Record<ArrowStatus, { active: string; inactive: string }> = {
  normal: { active: '#001970', inactive: '#c0c0d8' },
  added: { active: '#10b981', inactive: '#a7f3d0' }, // emerald
  removed: { active: '#ef4444', inactive: '#fecaca' }, // red
  'to-new': { active: '#10b981', inactive: '#a7f3d0' }, // emerald
  'to-deleted': { active: '#ef4444', inactive: '#fecaca' }, // red
}

function Arrow({
  fromId,
  toId,
  rows,
  scale,
  strokeWidth,
  parentMap,
  status,
}: ArrowProps) {
  const { model, hoveredNodeId, showChildren } = useMainContext()
  const nodes = model.nodes
  const [path, setPath] = useState<string>('')
  const [isDashed, setIsDashed] = useState(false)

  // Arrow is related if nothing is hovered, or if it directly connects to the hovered node
  const isRelated =
    hoveredNodeId === null || fromId === hoveredNodeId || toId === hoveredNodeId
  const colors = STATUS_COLORS[status]
  const color = isRelated ? colors.active : colors.inactive

  // Get all visible node IDs from rows (stable reference via JSON comparison)
  const visibleNodeIds = useMemo(() => rows.flat(), [rows])

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
      const gapPerArrow = 6
      const maxStaggerWidth = Math.min(toRect.width * 0.5, 30)
      const toStaggerWidth = Math.min((totalDeps - 1) * gapPerArrow, maxStaggerWidth)
      const toStaggerStep = totalDeps > 1 ? toStaggerWidth / (totalDeps - 1) : 0
      const toXOffset =
        totalDeps > 1 ? depIndex * toStaggerStep - toStaggerWidth / 2 : 0

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

/** Build a map: childId -> list of parent nodeIds that depend on it (for staggering) */
function buildParentMap(
  nodes: ModelNodes,
  diffs: ModelNode[]
): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  const diffMap = new Map(diffs.map((d) => [d.id, d]))

  // Add dependencies from model nodes
  for (const [nodeId, node] of Object.entries(nodes)) {
    for (const depId of node.dependencies) {
      if (!map[depId]) map[depId] = []
      if (!map[depId].includes(nodeId)) map[depId].push(nodeId)
    }

    // Also add diff-added dependencies for this node
    const diff = diffMap.get(nodeId)
    if (diff) {
      for (const depId of diff.dependencies) {
        if (!map[depId]) map[depId] = []
        if (!map[depId].includes(nodeId)) map[depId].push(nodeId)
      }
    }
  }

  // Include dependencies from new nodes (nodes only in diffs)
  for (const diff of diffs) {
    if (!(diff.id in nodes)) {
      for (const depId of diff.dependencies) {
        if (!map[depId]) map[depId] = []
        if (!map[depId].includes(diff.id)) map[depId].push(diff.id)
      }
    }
  }

  return map
}

export function Arrows({ rows }: ArrowsProps) {
  const { model, diffs, hoveredNodeId } = useMainContext()
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

  // Trigger arrow recalculation when model or diffs change
  useEffect(() => {
    // Use requestAnimationFrame to wait for DOM to update
    const frameId = requestAnimationFrame(() => {
      window.dispatchEvent(new Event('containerresize'))
    })
    return () => cancelAnimationFrame(frameId)
  }, [nodes, diffs])

  // Build sets for diff analysis
  const { newNodeIds, deletedNodeIds, diffMap } = useMemo(() => {
    const newNodeIds = new Set<string>()
    const deletedNodeIds = new Set<string>()
    const diffMap = new Map<string, ModelNode>()

    for (const diff of diffs) {
      diffMap.set(diff.id, diff)
      if (!(diff.id in nodes)) {
        newNodeIds.add(diff.id)
      }
      if (diff.deletedVersion !== undefined) {
        deletedNodeIds.add(diff.id)
      }
    }

    return { newNodeIds, deletedNodeIds, diffMap }
  }, [diffs, nodes])

  // Pre-compute parent map once when nodes change
  const parentMap = useMemo(() => buildParentMap(nodes, diffs), [nodes, diffs])

  // Collect all arrows with their status
  const arrows = useMemo(() => {
    const arrowMap = new Map<string, { fromId: string; toId: string; status: ArrowStatus }>()
    const key = (from: string, to: string) => `${from}->${to}`

    // Add arrows from model nodes
    for (const [nodeId, node] of Object.entries(nodes)) {
      const diff = diffMap.get(nodeId)
      const diffDeps = new Set(diff?.dependencies ?? [])
      const originalDeps = new Set(node.dependencies)

      for (const depId of node.dependencies) {
        let status: ArrowStatus = 'normal'

        if (deletedNodeIds.has(depId)) {
          status = 'to-deleted'
        } else if (diff && !diffDeps.has(depId)) {
          // Arrow exists in original but not in diff - being removed
          status = 'removed'
        }

        arrowMap.set(key(nodeId, depId), { fromId: nodeId, toId: depId, status })
      }

      // Add arrows that are in diff but not in original (being added)
      if (diff) {
        for (const depId of diff.dependencies) {
          if (!originalDeps.has(depId)) {
            let status: ArrowStatus = 'added'
            if (newNodeIds.has(depId)) {
              status = 'to-new'
            }
            arrowMap.set(key(nodeId, depId), { fromId: nodeId, toId: depId, status })
          }
        }
      }
    }

    // Add arrows from new nodes (nodes only in diffs)
    for (const diff of diffs) {
      if (newNodeIds.has(diff.id)) {
        for (const depId of diff.dependencies) {
          let status: ArrowStatus = 'to-new'
          if (newNodeIds.has(depId)) {
            status = 'to-new'
          }
          arrowMap.set(key(diff.id, depId), { fromId: diff.id, toId: depId, status })
        }
      }
    }

    return [...arrowMap.values()]
  }, [nodes, diffs, diffMap, newNodeIds, deletedNodeIds])

  // Sort so related arrows render last (on top in SVG)
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
      {sortedArrows.map(({ fromId, toId, status }) => (
        <Arrow
          key={`${fromId}-${toId}`}
          fromId={fromId}
          toId={toId}
          rows={rows}
          scale={scale}
          strokeWidth={strokeWidth}
          parentMap={parentMap}
          status={status}
        />
      ))}
    </svg>
  )
}
