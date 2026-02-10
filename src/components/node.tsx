import {
  useIsHoveredRelated,
  useMainContext,
  useNode,
  useUpdateNode,
} from '@/context'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Minus, Plus } from 'lucide-react'
import { getDependents } from '@/lib/nodes'
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
  const { setHoveredNodeId, nodes } = useMainContext()
  const node = useNode(id)
  const updateNode = useUpdateNode()

  const hasDependents = getDependents(id, nodes).length > 0

  const toggleShowChildren = () => {
    updateNode(id, { showChildren: !node.showChildren })
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
            <div className="text-center font-medium">{id}</div>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Are you absolutely sure?</SheetTitle>
              <SheetDescription>This action cannot be undone.</SheetDescription>
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
            {node.showChildren ? (
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
