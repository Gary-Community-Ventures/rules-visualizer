import { useEffect, useState } from 'react'
import { useMainContext } from '@/context'
import { nodeElementId } from './node'

type ArrowProps = {
  fromId: string
  toId: string
  rows: string[][]
}

function Arrow({ fromId, toId, rows }: ArrowProps) {
  const { model, hoveredNodeId, showChildren } = useMainContext()
  const nodes = model.nodes
  const [path, setPath] = useState<string>('')
  const [isDashed, setIsDashed] = useState(false)
  const [color] = useState('#001970')

  const isRelated =
    hoveredNodeId === null || fromId === hoveredNodeId || toId === hoveredNodeId

  const visibleNodeIds = rows.flat()
  const isFromVisible = visibleNodeIds.includes(fromId)
  const isToVisible = visibleNodeIds.includes(toId)
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

      const toNode = nodes[toId]
      const toDeps = toNode.type === 'decision' ? toNode.dependencies : []
      const depIndex = toDeps.indexOf(fromId)
      const totalDeps = toDeps.length
      const staggerWidth = 5
      const staggerStep = totalDeps > 1 ? staggerWidth / (totalDeps - 1) : 0
      const toXOffset =
        totalDeps > 1 ? depIndex * staggerStep - staggerWidth / 2 : 0

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
    window.addEventListener('scroll', updateArrow)
    window.addEventListener('pan', updateArrow)

    return () => {
      window.removeEventListener('resize', updateArrow)
      window.removeEventListener('scroll', updateArrow)
      window.removeEventListener('pan', updateArrow)
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
  ])

  if (!path) {
    return null
  }

  const isHoverAnimated = isRelated && hoveredNodeId !== null

  return (
    <svg
      className="fixed top-0 left-0 w-full h-full pointer-events-none"
      style={{ zIndex: -1 }}
    >
      <style>
        {`
          @keyframes flow {
            from { stroke-dashoffset: 0; }
            to { stroke-dashoffset: 16; }
          }
        `}
      </style>
      <path
        d={path}
        stroke={color}
        strokeWidth="2"
        fill="none"
        strokeDasharray={isDashed || isHoverAnimated ? '8,8' : undefined}
        opacity={isRelated ? 1 : 0.2}
        style={
          isHoverAnimated
            ? { animation: 'flow 0.5s linear infinite' }
            : undefined
        }
      />
    </svg>
  )
}

type ArrowsProps = {
  rows: string[][]
}

export function Arrows({ rows }: ArrowsProps) {
  const { model } = useMainContext()
  const nodes = model.nodes

  const arrows: { fromId: string; toId: string }[] = []

  for (const [nodeId, node] of Object.entries(nodes)) {
    const deps = node.type === 'decision' ? node.dependencies : []
    for (const depId of deps) {
      arrows.push({ fromId: depId, toId: nodeId })
    }
  }

  return (
    <>
      {arrows.map(({ fromId, toId }) => (
        <Arrow
          key={`${fromId}-${toId}`}
          fromId={fromId}
          toId={toId}
          rows={rows}
        />
      ))}
    </>
  )
}
