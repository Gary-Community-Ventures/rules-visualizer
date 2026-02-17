import {
  useDiff,
  useMainContext,
  useNode,
  useUpdateDiff,
  useUpdateNode,
} from '@/context'
import { Button } from './ui/button'
import {
  Minus,
  Plus,
  CircleDot,
  Hash,
  Braces,
  Table as TableIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Editor } from './inputs/editor'
import { NodeInput } from './node-input'
import { NodeResultBadge } from './node-result'
import { TextInput } from './inputs/text'

const NODE_TYPE_CONFIG = {
  input: { icon: CircleDot, bg: 'bg-blue-50', border: 'border-blue-200' },
  constant: { icon: Hash, bg: 'bg-amber-50', border: 'border-amber-200' },
  context: { icon: Braces, bg: 'bg-purple-50', border: 'border-purple-200' },
  decisionTable: {
    icon: TableIcon,
    bg: 'bg-orange-50',
    border: 'border-orange-200',
  },
}

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

  const config = NODE_TYPE_CONFIG[node.content.type]
  const Icon = config.icon

  const toggleShowChildren = () => {
    setShowChildren((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div
      className={cn(config.bg, 'relative')}
      onMouseEnter={() => setHoveredNodeId(id)}
      onMouseLeave={() => setHoveredNodeId(null)}
    >
      <div
        id={nodeElementId(id)}
        className={cn(
          config.border,
          'border p-5 h-full relative flex flex-col items-center'
        )}
        onClick={() => {
          setOpenNode(id)
        }}
      >
        <div className="flex items-center gap-1.5">
          <Icon className="size-3.5 text-muted-foreground" />
          <span className="text-center font-medium whitespace-nowrap">
            {node.name}
          </span>
        </div>
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
  const updateNode = useUpdateNode()
  const diff = useDiff(id)
  const updateDiff = useUpdateDiff()

  let nameDiff:
    | { new: string; update: (newValue: string) => void }
    | undefined = undefined
  if (diff !== undefined) {
    nameDiff = {
      new: diff.name,
      update: (newValue) =>
        updateDiff(id, (diff) => ({ ...diff, name: newValue })),
    }
  }

  return (
    <section className="flex flex-col gap-10">
      <div>
        Name:
        <TextInput
          text={node.name}
          updateText={(name) => updateNode(id, (node) => ({ ...node, name }))}
          diff={nameDiff}
        />
      </div>
      <div>
        Editor:
        <Editor node={node} />
      </div>
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
