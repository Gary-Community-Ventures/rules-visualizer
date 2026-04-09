import { useState } from 'react'
import { useFindNode, useMainContext } from '@/context'
import {
  isInputNode,
  isConstantNode,
  isOverridable,
  getTypeHint,
} from '@/context/model-context'
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
  BookOpen,
  Trash2,
  Check,
  Bookmark,
  BookmarkCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ContentViewer } from './content-viewers'
import type { ModelNode, NodeContent } from '@/lib/model'
import { getDependents } from '@/lib/graph'
import { HoverCard, HoverCardTrigger, HoverCardContent } from './ui/hover-card'
import { resolveRacLogic } from '@/lib/logic'

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
    icon: BookOpen,
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
    inputOverrides,
    setInputOverride,
    clearInputOverride,
    runOnBlur,
  } = useMainContext()

  const [isHovered, setIsHovered] = useState(false)
  const result = executionResults?.[node.id]
  const overrideValue = inputOverrides[node.id] ?? ''
  const hasOverride = overrideValue !== ''
  const isInput = isInputNode(node)
  const isEditable = isOverridable(node)
  const declaredDefault = (() => {
    const c = node.content
    if (c.format === 'rac' && c.type === 'variable' && c.default)
      return c.default
    if (
      c.format === 'factGraph' &&
      c.type === 'derived' &&
      c.role === 'constant' &&
      c.logic
    ) {
      const match = c.logic.match(/>([^<]+)<\//)
      if (match) return match[1]
    }
    return undefined
  })()
  const typeHint = getTypeHint(node)
  const hasChildren = node.dependencies.length > 0
  const config = NODE_TYPE_CONFIG[getNodeRole(node.content)] ?? DEFAULT_CONFIG
  const Icon = config.icon

  const toggleShowChildren = () => {
    setShowChildren((prev) => ({
      ...prev,
      [node.id]: prev[node.id] !== true,
    }))
  }

  return (
    <div
      className={cn(config.bg, 'relative z-10')}
      onMouseEnter={() => {
        setHoveredNodeId(node.id)
        setIsHovered(true)
      }}
      onMouseLeave={() => {
        setHoveredNodeId(null)
        setIsHovered(false)
      }}
    >
      <div
        id={nodeElementId(node.id)}
        className={cn(
          hasOverride
            ? isInput
              ? 'border-blue-400 ring-1 ring-blue-400'
              : 'border-amber-400 ring-1 ring-amber-400'
            : config.border,
          'border h-full relative flex flex-col items-center',
          isInput ? 'px-5 py-4' : 'p-5'
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

        {/* Input nodes: prominent field, always visible */}
        {isInput && (
          <div
            className="mt-2 flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <Input
              className={cn(
                'h-8 w-32 text-sm font-mono text-center',
                hasOverride
                  ? 'border-blue-400 ring-1 ring-blue-400'
                  : 'border-blue-300'
              )}
              placeholder={
                declaredDefault ?? typeHint?.toLowerCase() ?? 'required'
              }
              value={overrideValue}
              onChange={(e) => setInputOverride(node.id, e.target.value)}
              onBlur={runOnBlur}
            />
            {hasOverride && (
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => clearInputOverride(node.id)}
              >
                <Trash2 className="size-3" />
              </button>
            )}
          </div>
        )}

        {/* Constants/computed: small subtle field, only when hovered or has override */}
        {isEditable && !isInput && (hasOverride || isHovered) && (
          <div
            className="mt-1.5 flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <Input
              className={cn(
                'h-5 w-20 text-[11px] font-mono text-center border-dashed',
                hasOverride
                  ? 'border-amber-400 ring-1 ring-amber-400'
                  : 'border-muted-foreground/30'
              )}
              placeholder={
                typeHint?.toLowerCase() ??
                (isConstantNode(node) ? 'override' : 'pin')
              }
              value={overrideValue}
              onChange={(e) => setInputOverride(node.id, e.target.value)}
              onBlur={runOnBlur}
            />
            {hasOverride && (
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => clearInputOverride(node.id)}
              >
                <Trash2 className="size-2.5" />
              </button>
            )}
          </div>
        )}

        {/* Result value — clear colored badge */}
        {result && (
          <div
            className={cn(
              'mt-2 font-mono rounded px-2 py-0.5 truncate max-w-36 text-center',
              'text-xs bg-emerald-50 text-emerald-800 border border-emerald-200'
            )}
          >
            {formatResultValue(result.value)}
          </div>
        )}
      </div>
      {hasChildren && (
        <Button
          variant="outline"
          size="icon"
          className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-white h-6 w-6 z-10"
          onClick={toggleShowChildren}
        >
          {showChildren[node.id] === true ? (
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
  const { model } = useMainContext()
  const label =
    node.content.format === 'rac' && node.content.type === 'variable'
      ? node.content.label
      : undefined

  const deps = node.dependencies
    .map((id) => ({ id, name: model.nodes[id]?.name ?? id }))
    .filter((d) => model.nodes[d.id])
  const dependents = getDependents(node.id, model.nodes).map((id) => ({
    id,
    name: model.nodes[id]?.name ?? id,
  }))

  return (
    <section className="flex flex-col gap-4">
      {(label || node.description) && (
        <div>
          {label && <p className="text-sm text-foreground">{label}</p>}
          {node.description && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {node.description}
            </p>
          )}
        </div>
      )}

      {/* Content viewer */}
      <ContentViewer content={node.content} />

      {/* Connections */}
      <NodeLinkList label="Dependencies" nodeIds={deps} />
      <NodeLinkList label="Used by" nodeIds={dependents} />
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

function getNodePreview(
  node: ModelNode,
  logicYear: number
): {
  label?: string
  unit?: string
  logic?: string
  badge?: string
  dataType?: string
} {
  const c = node.content
  if (c.type === 'entity') return {}
  switch (c.format) {
    case 'rac':
      return {
        label: c.label,
        unit: c.unit,
        logic: resolveRacLogic(c.logic, c.default, logicYear),
      }
    case 'factGraph':
      switch (c.type) {
        case 'writable':
          return { badge: 'Writable', dataType: c.typeName, logic: c.logic }
        case 'derived':
          return { badge: 'Derived', dataType: c.dataType, logic: c.logic }
      }
  }
}

export function NodeLink({
  nodeId,
  name,
  onSelect,
}: {
  nodeId: string
  name: string
  onSelect?: () => void
}) {
  const { model, logicYear, setOpenNode } = useMainContext()
  const node = model.nodes[nodeId]
  const preview = node ? getNodePreview(node, logicYear) : null

  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          className="text-xs px-2 py-1 rounded-md border bg-muted/50 hover:bg-muted transition-colors text-left"
          onClick={onSelect ?? (() => setOpenNode(nodeId))}
        >
          {name}
        </button>
      </HoverCardTrigger>
      {preview && (preview.label || preview.logic || preview.badge) && (
        <HoverCardContent side="top" className="w-72">
          {(preview.badge || preview.dataType) && (
            <div className="flex items-center gap-2 mb-1">
              {preview.badge && (
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {preview.badge}
                </span>
              )}
              {preview.dataType && (
                <span className="text-[10px] font-mono text-muted-foreground">
                  {preview.dataType}
                </span>
              )}
            </div>
          )}
          {preview.label && (
            <p className="text-sm font-medium">{preview.label}</p>
          )}
          {preview.unit && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {preview.unit}
            </p>
          )}
          {preview.logic && (
            <pre className="mt-2 rounded border bg-muted/50 p-2 text-xs whitespace-pre-wrap font-mono max-h-32 overflow-y-auto">
              {preview.logic}
            </pre>
          )}
        </HoverCardContent>
      )}
    </HoverCard>
  )
}

export function NodeLinkList({
  label,
  nodeIds,
}: {
  label: string
  nodeIds: { id: string; name: string }[]
}) {
  if (nodeIds.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-muted-foreground">
        {label}
      </label>
      <div className="flex flex-wrap gap-1.5">
        {nodeIds.map((dep) => (
          <NodeLink key={dep.id} nodeId={dep.id} name={dep.name} />
        ))}
      </div>
    </div>
  )
}

function CopyableName({ name }: { name: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <h2
      className="text-sm font-semibold truncate cursor-pointer hover:text-muted-foreground transition-colors"
      title="Click to copy"
      onClick={() => {
        navigator.clipboard.writeText(name)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? (
        <span className="text-emerald-600 flex items-center gap-1">
          <Check className="size-3" />
          Copied
        </span>
      ) : (
        name
      )}
    </h2>
  )
}

export function NodePanel() {
  const {
    openNode,
    setOpenNode,
    executionResults,
    inputOverrides,
    setInputOverride,
    clearInputOverride,
    runOnBlur,
    workspaceItems,
    setWorkspaceItems,
  } = useMainContext()
  const openNodeData = useFindNode(openNode)

  if (openNode === null || openNodeData === undefined) {
    return null
  }

  const inWorkspace = workspaceItems.includes(openNode)
  const isInput = isInputNode(openNodeData)
  const isConstant = isConstantNode(openNodeData)
  const canEdit = isOverridable(openNodeData)

  const config =
    NODE_TYPE_CONFIG[getNodeRole(openNodeData.content)] ?? DEFAULT_CONFIG
  const TypeIcon = config.icon

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between px-5 py-3 border-b shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <CopyableName name={openNodeData.name} />
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium shrink-0',
              config.badgeBg
            )}
          >
            <TypeIcon className="size-3" />
            {config.label}
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={inWorkspace ? 'Remove from workspace (W)' : 'Add to workspace (W)'}
            onClick={() =>
              inWorkspace
                ? setWorkspaceItems((prev) => prev.filter((id) => id !== openNode))
                : setWorkspaceItems((prev) => [...prev, openNode])
            }
          >
            {inWorkspace ? (
              <BookmarkCheck className="size-4 text-primary" />
            ) : (
              <Bookmark className="size-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setOpenNode(null)}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        <NodeViewer node={openNodeData} />

        {/* Per-node value entry */}
        {canEdit && (
          <div className="mt-6 flex flex-col gap-1.5">
            <label className="text-sm font-medium text-muted-foreground">
              {isInput ? 'Value' : isConstant ? 'Override' : 'Pin Value'}
            </label>
            <div className="flex gap-1.5">
              <Input
                className={cn(
                  'h-8 text-sm font-mono flex-1',
                  inputOverrides[openNode] &&
                    (isInput
                      ? 'border-blue-400 ring-1 ring-blue-400'
                      : 'border-amber-400 ring-1 ring-amber-400')
                )}
                placeholder={
                  isInput
                    ? 'Enter value...'
                    : isConstant
                      ? 'Override default...'
                      : 'Pin to value...'
                }
                value={inputOverrides[openNode] ?? ''}
                onChange={(e) => setInputOverride(openNode, e.target.value)}
                onBlur={runOnBlur}
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
                : isConstant
                  ? 'Override this constant for simulation'
                  : 'Pin this node to skip its computation'}
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
      </div>
    </div>
  )
}
