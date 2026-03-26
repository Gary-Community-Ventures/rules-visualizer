import { useFindNode, useMainContext } from '@/context'
import { isInputNode, isConstantNode } from '@/context/model-context'
import { Button } from './ui/button'
import { Input } from './ui/input'
import {
  Minus,
  Plus,
  X,
  Variable,
  Box,
  PencilLine,
  GitBranch,
  Lock,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ContentViewer } from './content-viewers'
import type { ModelNode, NodeContent } from '@/lib/model'
import { getDependents } from '@/lib/graph'

function getNodeRole(content: NodeContent): string {
  if (content.type === 'entity') return 'entity'
  return content.role
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
  input: {
    icon: PencilLine,
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    label: 'Input',
    badgeBg: 'bg-blue-100 text-blue-700',
  },
  constant: {
    icon: Lock,
    bg: 'bg-gray-50',
    border: 'border-gray-200',
    label: 'Constant',
    badgeBg: 'bg-gray-100 text-gray-600',
  },
  computed: {
    icon: GitBranch,
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    label: 'Computed',
    badgeBg: 'bg-purple-100 text-purple-700',
  },
  entity: {
    icon: Box,
    bg: 'bg-teal-50',
    border: 'border-teal-200',
    label: 'Entity',
    badgeBg: 'bg-teal-100 text-teal-700',
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

function formatResultValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toLocaleString()
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
  }
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return `[${value.length} items]`
  }
  return String(value)
}

export function Node({ node }: NodeProps) {
  const {
    setHoveredNodeId,
    showChildren,
    setShowChildren,
    setOpenNode,
    executionResults,
  } = useMainContext()

  const result = executionResults?.[node.id]
  const hasChildren = node.dependencies.length > 0
  const config =
    NODE_TYPE_CONFIG[getNodeRole(node.content)] ?? DEFAULT_CONFIG
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
        {result && (
          <span className="mt-1 text-xs font-mono text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5 max-w-32 truncate">
            {formatResultValue(result.value)}
          </span>
        )}
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
    NODE_TYPE_CONFIG[getNodeRole(node.content)] ?? DEFAULT_CONFIG
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
  const {
    model,
    openNode,
    setOpenNode,
    executionResults,
    inputOverrides,
    setInputOverride,
    clearInputOverride,
  } = useMainContext()
  const openNodeData = useFindNode(openNode)

  if (openNode === null || openNodeData === undefined) {
    return null
  }

  const dependentIds = getDependents(openNode, model.nodes)
  const dependentNames = dependentIds.map((id) => model.nodes[id]?.name ?? id)
  const isInput = isInputNode(openNodeData)
  const isConstant = isConstantNode(openNodeData)
  const canEdit = isInput || isConstant

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

        {/* Per-node value entry */}
        {canEdit && (
          <div className="mt-6 flex flex-col gap-1.5">
            <label className="text-sm font-medium text-muted-foreground">
              {isInput ? 'Value' : 'Override'}
            </label>
            <div className="flex gap-1.5">
              <Input
                className="h-8 text-sm font-mono flex-1"
                placeholder={isInput ? 'Enter value...' : 'Override default...'}
                value={inputOverrides[openNode] ?? ''}
                onChange={(e) => setInputOverride(openNode, e.target.value)}
              />
              {inputOverrides[openNode] && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => clearInputOverride(openNode)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {isInput
                ? 'Provide this value before running'
                : 'Override this constant for simulation'}
            </p>
          </div>
        )}

        {/* Execution result */}
        {executionResults?.[openNode] && (
          <div className="mt-6 flex flex-col gap-1.5">
            <label className="text-sm font-medium text-muted-foreground">
              Result
            </label>
            <pre className="text-sm bg-emerald-50 text-emerald-800 rounded-md p-3 overflow-x-auto">
              {JSON.stringify(executionResults[openNode].value, null, 2)}
            </pre>
            {executionResults[openNode].entity && (
              <span className="text-xs text-muted-foreground">
                Entity: {executionResults[openNode].entity}
              </span>
            )}
          </div>
        )}

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
