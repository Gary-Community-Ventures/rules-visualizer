import { useFindNode, useMainContext } from '@/context'
import { Button } from './ui/button'
import {
  Minus,
  Plus,
  X,
  Variable,
  Box,
  PencilLine,
  GitBranch,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ContentViewer } from './content-viewers'
import type { ModelNode, NodeContent } from '@/lib/model'
import { getDependents } from '@/lib/graph'

function getNodeTypeKey(content: NodeContent): string {
  return `${content.format}:${content.type}`
}

const NODE_TYPE_CONFIG: Record<
  string,
  {
    icon: typeof Variable
    bg: string
    border: string
    label: string
    badgeBg: string
  }
> = {
  'rac:variable': {
    icon: Variable,
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    label: 'Variable',
    badgeBg: 'bg-purple-100 text-purple-700',
  },
  'rac:entity': {
    icon: Box,
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    label: 'Entity',
    badgeBg: 'bg-blue-100 text-blue-700',
  },
  'factGraph:writable': {
    icon: PencilLine,
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    label: 'Writable',
    badgeBg: 'bg-blue-100 text-blue-700',
  },
  'factGraph:derived': {
    icon: GitBranch,
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    label: 'Derived',
    badgeBg: 'bg-orange-100 text-orange-700',
  },
}

const DEFAULT_CONFIG = {
  icon: Box,
  bg: 'bg-gray-50',
  border: 'border-gray-200',
  label: 'Node',
  badgeBg: 'bg-gray-100 text-gray-700',
}

type NodeProps = {
  node: ModelNode
}

export function nodeElementId(id: string) {
  return `node-${id}`
}

export function Node({ node }: NodeProps) {
  const { setHoveredNodeId, showChildren, setShowChildren, setOpenNode } =
    useMainContext()

  const hasChildren = node.dependencies.length > 0
  const config =
    NODE_TYPE_CONFIG[getNodeTypeKey(node.content)] ?? DEFAULT_CONFIG
  const Icon = config.icon

  const toggleShowChildren = () => {
    setShowChildren((prev) => ({
      ...prev,
      [node.id]: prev[node.id] === false,
    }))
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
          'border p-5 h-full relative flex flex-col items-center'
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
      </div>
      {hasChildren && (
        <Button
          variant="outline"
          size="icon"
          className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-white h-6 w-6"
          onClick={toggleShowChildren}
        >
          {showChildren[node.id] !== false ? (
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
  const config =
    NODE_TYPE_CONFIG[getNodeTypeKey(node.content)] ?? DEFAULT_CONFIG
  const Icon = config.icon

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

      {/* Name */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-muted-foreground">
          Name
        </label>
        <p className="text-sm">{node.name}</p>
      </div>

      {/* Description */}
      {node.description && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-muted-foreground">
            Description
          </label>
          <p className="text-sm">{node.description}</p>
        </div>
      )}

      {/* Tags */}
      {node.tags && node.tags.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-muted-foreground">
            Tags
          </label>
          <div className="flex flex-wrap gap-1">
            {node.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-muted px-2 py-0.5 text-xs"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Content viewer */}
      <ContentViewer content={node.content} />
    </section>
  )
}

type RowsProps = {
  rows: string[][]
}

export function Rows({ rows }: RowsProps) {
  const { model } = useMainContext()

  return (
    <div className="flex flex-col gap-20">
      {rows.map((row, i) => {
        return (
          <div key={i} className="flex gap-10 justify-center">
            {row.map((id) => {
              const node = model.nodes[id]
              if (!node) return null
              return <Node node={node} key={id} />
            })}
          </div>
        )
      })}
    </div>
  )
}

export function NodePanel() {
  const { model, openNode, setOpenNode } = useMainContext()
  const openNodeData = useFindNode(openNode)

  if (openNode === null || openNodeData === undefined) {
    return null
  }

  const dependentIds = getDependents(openNode, model.nodes)
  const dependentNames = dependentIds.map((id) => model.nodes[id]?.name ?? id)

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
        <h2 className="text-sm font-semibold">Node Details</h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setOpenNode(null)}
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        <NodeViewer node={openNodeData} />

        {/* Dependents */}
        {dependentNames.length > 0 && (
          <div className="mt-6 flex flex-col gap-1.5">
            <label className="text-sm font-medium text-muted-foreground">
              Referenced by
            </label>
            <ul className="list-disc list-inside text-sm">
              {dependentNames.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
