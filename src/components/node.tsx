import { useMainContext, useNode } from '@/context'
import { Button } from './ui/button'
import { Minus, Plus } from 'lucide-react'
import { getDependents } from '@/lib/graph'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './ui/sheet'

type NodeProps = {
  id: string
}

export function nodeElementId(id: string) {
  return `node-${id}`
}

export function Node({ id }: NodeProps) {
  const { setHoveredNodeId, model, showChildren, setShowChildren } =
    useMainContext()
  const node = useNode(id)

  const hasDependents = getDependents(id, model.nodes).length > 0

  const toggleShowChildren = () => {
    setShowChildren((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div
      className="bg-white/90"
      onMouseEnter={() => setHoveredNodeId(id)}
      onMouseLeave={() => setHoveredNodeId(null)}
    >
      <div id={nodeElementId(id)} className="border p-5 h-full relative">
        <Sheet>
          <SheetTrigger>
            <div className="text-center font-medium">{node.name}</div>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{node.name}</SheetTitle>
              <SheetDescription>{node.id}</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
        {hasDependents && (
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
    </div>
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
