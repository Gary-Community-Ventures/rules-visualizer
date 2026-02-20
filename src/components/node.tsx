import {
  useDiff,
  useMainContext,
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
import { NodeTests } from './inputs/node-tests'
import type { ModelNode } from '@/lib/model'
import { useMemo } from 'react'

const NODE_TYPE_CONFIG = {
  input: {
    icon: CircleDot,
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    label: 'Input',
    badgeBg: 'bg-blue-100 text-blue-700',
  },
  constant: {
    icon: Hash,
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    label: 'Constant',
    badgeBg: 'bg-amber-100 text-amber-700',
  },
  context: {
    icon: Braces,
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    label: 'Decision',
    badgeBg: 'bg-purple-100 text-purple-700',
  },
  decisionTable: {
    icon: TableIcon,
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    label: 'Decision Table',
    badgeBg: 'bg-orange-100 text-orange-700',
  },
}

type NodeProps = {
  node: ModelNode
}

export function nodeElementId(id: string) {
  return `node-${id}`
}

export function Node({ node }: NodeProps) {
  const {
    setHoveredNodeId,
    showChildren,
    setShowChildren,
    setOpenNode,
    diffs,
    model,
  } = useMainContext()

  const hasChildren = node.dependencies.length > 0
  const isInput = node.content.type === 'input'

  const diffBorderClass = useMemo(() => {
    const alreadyExists = model.nodes[node.id] !== undefined
    const diff = diffs.find((d) => d.id === node.id)

    if (!alreadyExists && diff !== undefined) {
      return 'border-emerald-400 border-2'
    }

    if (alreadyExists && diff?.deletedVersion !== undefined) {
      return 'border-red-400 border-2'
    }
    return null
  }, [diffs, model, node])

  const config = NODE_TYPE_CONFIG[node.content.type]
  const Icon = config.icon

  const toggleShowChildren = () => {
    setShowChildren((prev) => ({ ...prev, [node.id]: !prev[node.id] }))
  }

  return (
    <div
      className={cn(config.bg, 'relative')}
      onMouseEnter={() => setHoveredNodeId(node.id)}
      onMouseLeave={() => setHoveredNodeId(null)}
    >
      <div
        id={nodeElementId(node.id)}
        className={cn(
          config.border,
          'border p-5 h-full relative flex flex-col items-center',
          diffBorderClass
        )}
        onClick={() => {
          setOpenNode(node.id)
        }}
      >
        <div className="flex items-center gap-1.5">
          <Icon className="size-3.5 text-muted-foreground" />
          <span className="text-center font-medium whitespace-nowrap">
            {node.name}
          </span>
        </div>
        <NodeResultBadge nodeId={node.id} />
        {isInput && <NodeInput node={node} />}
      </div>
      {hasChildren && (
        <Button
          variant="outline"
          size="icon"
          className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-white h-6 w-6"
          onClick={toggleShowChildren}
        >
          {showChildren[node.id] ? (
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
  node: ModelNode
}

export function NodeViewer({ node }: NodeViewerProps) {
  const { model, diffs } = useMainContext()
  const updateNode = useUpdateNode()
  const diff = useDiff(node.id)
  const updateDiff = useUpdateDiff()

  const config = NODE_TYPE_CONFIG[node.content.type]
  const Icon = config.icon

  let nameDiff:
    | { new: string; update: (newValue: string) => void }
    | undefined = undefined
  if (diff !== undefined) {
    nameDiff = {
      new: diff.name,
      update: (newValue) =>
        updateDiff(node.id, (diff) => ({
          ...diff,
          name: newValue.replace(/ /g, '_'),
        })),
    }
  }

  return (
    <section className="flex flex-col gap-6">
      {/* Type badge */}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
            config.badgeBg
          )}
        >
          <Icon className="size-3" />
          {config.label}
        </span>
      </div>

      {/* Name section */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-muted-foreground">
          Name
        </label>
        <TextInput
          text={node.name}
          updateText={(name) =>
            updateNode(node.id, (node) => ({
              ...node,
              name: name.replace(/ /g, '_'),
            }))
          }
          diff={nameDiff}
        />
      </div>

      {/* Content section */}
      {node.content.type === 'input' ? (
        <p className="text-sm text-muted-foreground">
          This node receives external input at execution time.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-muted-foreground">
            Content
          </label>
          <Editor node={node} />
        </div>
      )}
      {/* Tests section (non-input nodes only) */}
      {node.content.type !== 'input' && (
        <NodeTests node={node} allNodes={model.nodes} diff={diff} />
      )}
      {diffs.find((d) => d.id === node.id) !== undefined && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 text-red-600 hover:text-red-700 hover:bg-red-50"
            onClick={() => resolveDiff(node.id, false)}
          >
            <X className="size-4 mr-2" />
            Reject
          </Button>
          <Button
            variant="outline"
            className="flex-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
            onClick={() => resolveDiff(node.id, true)}
          >
            <Check className="size-4 mr-2" />
            Accept
          </Button>
        </div>
      )}
    </section>
  )
}

type RowsProps = {
  rows: string[][]
}

export function Rows({ rows }: RowsProps) {
  const { model, diffs } = useMainContext()

  return (
    <div className="flex flex-col gap-20">
      {rows.map((row, i) => {
        return (
          <div key={i} className="flex gap-10 justify-center">
            {row.map((id) => {
              let node = model.nodes[id]
              const diff = diffs.find((d) => d.id === id)
              if (node === undefined && diff !== undefined) {
                node = diff
              }

              return <Node node={node} key={id} />
            })}
          </div>
        )
      })}
    </div>
  )
}
