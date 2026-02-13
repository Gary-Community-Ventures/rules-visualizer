import { useMainContext, useNode } from '@/context'
import { Button } from './ui/button'
import { Minus, Plus } from 'lucide-react'
import { Editor } from './inputs/editor'
import { NodeInput } from './node-input'
import { NodeResultBadge } from './node-result'

type NodeProps = {
  id: string
}

export function nodeElementId(id: string) {
  return `node-${id}`
}

export function Node({ id }: NodeProps) {
  const { setHoveredNodeId, showChildren, setShowChildren, setOpenNode } =
    useMainContext()
  const node = useNode(id)

  const hasChildren = node.dependencies.length > 0
  const isInput = node.content.type === 'input'

  const toggleShowChildren = () => {
    setShowChildren((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div
      className="bg-white/90 relative"
      onMouseEnter={() => setHoveredNodeId(id)}
      onMouseLeave={() => setHoveredNodeId(null)}
    >
      <div
        id={nodeElementId(id)}
        className="border p-5 h-full relative flex flex-col items-center"
        onClick={() => {
          setOpenNode(id)
        }}
      >
        <div className="text-center font-medium">{node.name}</div>
        <NodeResultBadge nodeId={id} />
        {isInput && <NodeInput nodeId={id} />}
      </div>
      {hasChildren && (
        <Button
          variant="outline"
          size="icon"
          className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-white h-6 w-6"
          onClick={toggleShowChildren}
        >
          {showChildren[id] ? (
            <Minus className="w-3 h-3" />
          ) : (
            <Plus className="w-3 h-3" />
          )}
        </Button>
      )}
    </div>
  )
}

type NodeViewerProps = {
  id: string
}

export function NodeViewer({ id }: NodeViewerProps) {
  const node = useNode(id)
  return (
    <section>
      <h2>{node.name}</h2>
      <p>{node.id}</p>
      <Editor node={node} />
    </section>
  )
}

type RowsProps = {
  rows: string[][]
}

export function Rows({ rows }: RowsProps) {
  return (
    <div className="flex flex-col gap-20">
      {rows.map((row, i) => {
        return (
          <div key={i} className="flex gap-10 justify-center">
            {row.map((id) => {
              return <Node id={id} key={id} />
            })}
          </div>
        )
      })}
    </div>
  )
}
