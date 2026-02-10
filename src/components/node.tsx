import { useIsHoveredRelated, useMainContext, useNode } from '@/context'
import { cn } from '@/lib/utils'

type NodeProps = {
  id: string
}

export function nodeElementId(id: string) {
  return `node-${id}`
}

export function Node({ id }: NodeProps) {
  const { setHoveredNodeId } = useMainContext()
  const isHoveredRelated = useIsHoveredRelated(id)

  const className = cn('bg-white/90', !isHoveredRelated && 'opacity-50')

  return (
    <div
      className={className}
      onMouseEnter={() => setHoveredNodeId(id)}
      onMouseLeave={() => setHoveredNodeId(null)}
    >
      <div id={nodeElementId(id)} className="border p-5 h-full relative">
        <div className="text-center font-medium">{id}</div>
      </div>
    </div>
  )
}

type RowsProps = {
  rows: string[][]
}

export function Rows({ rows }: RowsProps) {
  return (
    <div className="flex flex-col gap-8">
      {rows.map((row, i) => {
        return (
          <div key={i} className="flex gap-5 justify-center">
            {row.map((id) => {
              return <Node id={id} key={id} />
            })}
          </div>
        )
      })}
    </div>
  )
}
