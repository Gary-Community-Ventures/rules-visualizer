import { useState, useRef, useEffect } from 'react'
import { useFindNode, useMainContext } from '@/context'
import {
  isInputNode,
  isConstantNode,
  isOverridable,
  isCollectionParent,
  getCollectionInfo,
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
  CheckCircle,
  XCircle,
  Bookmark,
  BookmarkCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ContentViewer } from './content-viewers'
import type { ModelNode, NodeContent } from '@/lib/model'
import {
  getDependents,
  getAllDependencies,
  getAllDependents,
} from '@/lib/graph'
import * as ContextMenu from '@radix-ui/react-context-menu'
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

// Use shared format utilities
import { formatBadgeValue as formatResultValue } from '@/lib/format'

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
    activeTest,
  } = useMainContext()

  const [isHovered, setIsHovered] = useState(false)
  const result = executionResults?.[node.id]
  const overrideValue = inputOverrides[node.id] ?? ''
  const hasOverride = overrideValue !== ''
  const isInput = isInputNode(node)
  const isCollection = !!getCollectionInfo(node) || isCollectionParent(node)
  const isEditable = isOverridable(node) && !isCollection
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

        {/* Collection indicator */}
        {isCollection && !isCollectionParent(node) && (
          <span className="mt-0.5 text-[9px] text-muted-foreground/60">
            {(() => {
              const info = getCollectionInfo(node)
              if (!info) return ''
              const name = info.collection.startsWith('/')
                ? info.collection.slice(1)
                : info.collection
              return `per ${name}`
            })()}
          </span>
        )}

        {/* Input nodes in test mode: show test value as read-only badge */}
        {isInput && !isCollection && activeTest?.inputs && (() => {
          const nodePath = node.content.type !== 'entity' ? node.content.path : null
          const testValue = nodePath ? activeTest?.inputs[nodePath] : undefined
          if (testValue !== undefined) {
            return (
              <div className="mt-1.5 font-mono text-xs text-blue-700 bg-blue-50 rounded px-2 py-0.5 border border-blue-200">
                {formatResultValue(testValue)}
              </div>
            )
          }
          return null
        })()}

        {/* Input nodes: prominent field, always visible (but not for collection-scoped) */}
        {isInput && !isCollection && (
          <div
            className={cn('mt-2 flex items-center gap-1 h-8', activeTest && 'invisible')}
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

        {/* Constants/computed: always reserve space, show field on hover */}
        {isEditable && !isInput && (
          <div
            className={cn(
              'mt-1.5 flex items-center gap-1 h-5',
              (activeTest || (!hasOverride && !isHovered)) && 'invisible'
            )}
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

        {/* Result value — with optional test expectation */}
        {(() => {
          const nodePath = node.content.type !== 'entity' ? node.content.path : null
          const testExp = nodePath && activeTest ? activeTest.expectations[nodePath] : null

          if (testExp) {
            return (
              <div
                className={cn(
                  'mt-2 font-mono rounded px-2 py-0.5 max-w-44 text-center text-xs border',
                  testExp.passed
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-red-50 text-red-800 border-red-200'
                )}
              >
                <div className="flex items-center gap-1 justify-center">
                  {testExp.passed ? (
                    <CheckCircle className="size-3 text-emerald-600 shrink-0" />
                  ) : (
                    <XCircle className="size-3 text-red-600 shrink-0" />
                  )}
                  <span className="truncate">{formatResultValue(testExp.actual)}</span>
                </div>
                {!testExp.passed && (
                  <div className="text-[10px] text-red-500 truncate">
                    expected {formatResultValue(testExp.expected)}
                  </div>
                )}
              </div>
            )
          }

          // In test mode: show computed value from test run for nodes without expectations
          if (activeTest?.computedValues && nodePath) {
            const computed = activeTest?.computedValues[nodePath]
            if (computed !== undefined) {
              return (
                <div className="mt-2 font-mono rounded px-2 py-0.5 truncate max-w-36 text-center text-xs bg-gray-50 text-gray-600 border border-gray-200">
                  {formatResultValue(computed)}
                </div>
              )
            }
          }

          // Normal execution result (non-test mode)
          if (result && !activeTest) {
            return (
              <div
                className={cn(
                  'mt-2 font-mono rounded px-2 py-0.5 truncate max-w-36 text-center',
                  'text-xs bg-emerald-50 text-emerald-800 border border-emerald-200'
                )}
              >
                {formatResultValue(result.value)}
              </div>
            )
          }

          return null
        })()}
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
    node.content.type === 'entity'
      ? undefined
      : node.content.format === 'rac' && node.content.type === 'variable'
        ? node.content.label
        : node.content.format === 'factGraph'
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

// Module-level viewport store — avoids per-component state updates
type Viewport = { top: number; left: number; bottom: number; right: number }

let currentViewport: Viewport = { top: 0, left: 0, bottom: 2000, right: 2000 }
const viewportListeners = new Set<() => void>()

// One global listener that updates the viewport
if (typeof window !== 'undefined') {
  const margin = 400
  const updateViewport = () => {
    const container = document.querySelector('[data-pan-container]')
    if (!container) return
    const rect = container.getBoundingClientRect()
    const inner = container.firstElementChild as HTMLElement | null
    if (!inner) return
    const style = getComputedStyle(inner)
    const matrix = new DOMMatrix(style.transform)
    const scale = matrix.a || 1
    const offsetX = matrix.e
    const offsetY = matrix.f
    currentViewport = {
      top: (-offsetY - margin) / scale,
      left: (-offsetX - margin) / scale,
      bottom: (-offsetY + rect.height + margin) / scale,
      right: (-offsetX + rect.width + margin) / scale,
    }
    for (const cb of viewportListeners) cb()
  }
  window.addEventListener('transform', updateViewport)
  window.addEventListener('resize', updateViewport)
}

function checkVisible(
  el: HTMLElement,
  size: { width: number; height: number } | null,
  vp: Viewport
) {
  const top = el.offsetTop
  const left = el.offsetLeft
  const w = size?.width ?? el.offsetWidth
  const h = size?.height ?? el.offsetHeight
  return (
    top + h > vp.top &&
    top < vp.bottom &&
    left + w > vp.left &&
    left < vp.right
  )
}

function useIsVisible(
  ref: React.RefObject<HTMLDivElement | null>,
  size: React.RefObject<{ width: number; height: number } | null>
) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const update = () => {
      const el = ref.current
      if (!el) return
      const next = checkVisible(el, size.current, currentViewport)
      setVisible((prev) => (prev === next ? prev : next))
    }
    update()
    viewportListeners.add(update)
    return () => { viewportListeners.delete(update) }
  }, [ref, size])

  return visible
}

export function Rows({ rows }: RowsProps) {
  // Re-check all node visibilities after layout changes
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      for (const cb of viewportListeners) cb()
    })
    return () => cancelAnimationFrame(id)
  }, [rows])

  return (
    <div className="flex flex-col gap-20">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-10 justify-center">
          {row.map((id) => (
            <VirtualNode key={id} id={id} />
          ))}
        </div>
      ))}
    </div>
  )
}

function VirtualNode({ id }: { id: string }) {
  const { model } = useMainContext()
  const node = model.nodes[id]
  const ref = useRef<HTMLDivElement>(null)
  const size = useRef<{ width: number; height: number } | null>(null)
  const visible = useIsVisible(ref, size)

  // Capture size when becoming invisible so placeholder keeps layout stable
  const prevVisible = useRef(visible)
  if (prevVisible.current && !visible && ref.current) {
    const el = ref.current
    if (el.offsetHeight > 0) {
      size.current = { width: el.offsetWidth, height: el.offsetHeight }
    }
  }
  prevVisible.current = visible

  return (
    <div
      ref={ref}
      id={nodeElementId(id)}
      data-rendered={visible || undefined}
      style={
        !visible && size.current
          ? { minWidth: size.current.width, minHeight: size.current.height }
          : undefined
      }
    >
      {visible && node && <Node node={node} />}
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
    model,
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
          <ContextMenu.Root>
            <ContextMenu.Trigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title={
                  inWorkspace
                    ? 'Remove from workspace (W)'
                    : 'Add to workspace (W)'
                }
                onClick={() =>
                  inWorkspace
                    ? setWorkspaceItems((prev) =>
                        prev.filter((id) => id !== openNode)
                      )
                    : setWorkspaceItems((prev) => [...prev, openNode])
                }
              >
                {inWorkspace ? (
                  <BookmarkCheck className="size-4 text-primary" />
                ) : (
                  <Bookmark className="size-4" />
                )}
              </Button>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content className="z-50 min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                <ContextMenu.Item
                  className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
                  onSelect={() => {
                    const direct = openNodeData.dependencies.filter(
                      (id) => model.nodes[id]
                    )
                    setWorkspaceItems((prev) => [
                      ...new Set([...prev, openNode, ...direct]),
                    ])
                  }}
                >
                  Add with dependencies (
                  {
                    openNodeData.dependencies.filter((id) => model.nodes[id])
                      .length
                  }
                  )
                </ContextMenu.Item>
                <ContextMenu.Item
                  className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
                  onSelect={() => {
                    const direct = getDependents(openNode, model.nodes)
                    setWorkspaceItems((prev) => [
                      ...new Set([...prev, openNode, ...direct]),
                    ])
                  }}
                >
                  Add with dependents (
                  {getDependents(openNode, model.nodes).length})
                </ContextMenu.Item>
                <ContextMenu.Separator className="h-px my-1 bg-border" />
                <ContextMenu.Item
                  className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
                  onSelect={() => {
                    const deps = getAllDependencies(openNode, model.nodes)
                    setWorkspaceItems((prev) => [
                      ...new Set([...prev, openNode, ...deps]),
                    ])
                  }}
                >
                  Add with all dependencies (
                  {getAllDependencies(openNode, model.nodes).length})
                </ContextMenu.Item>
                <ContextMenu.Item
                  className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
                  onSelect={() => {
                    const deps = getAllDependents(openNode, model.nodes)
                    setWorkspaceItems((prev) => [
                      ...new Set([...prev, openNode, ...deps]),
                    ])
                  }}
                >
                  Add with all dependents (
                  {getAllDependents(openNode, model.nodes).length})
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>
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
