import { useState, useRef, useEffect } from 'react'
import { useFindNode, useMainContext } from '@/context'
import {
  isInputNode,
  isConstantNode,
  isOverridable,
  isCollectionParent,
  getCollectionInfo,
  getCollectionFieldKey,
  getCollectionOverridableFields,
  getCollectionDisplayName,
  getTypeHint,
  getNodePath,
} from '@/context/model-context'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { EntityEditor } from './execution-panel'
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
  Filter,
  FilterX,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  FileText,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ContentViewer } from './content-viewers'
import type {
  ModelNode,
  NodeContent,
  ResolvedReference,
  PolicyReferences,
} from '@/lib/model'
import { getReferences, saveReferences } from '@/lib/api/rules-api'
import {
  getDependents,
  getAllDependencies,
  getAllDependents,
} from '@/lib/graph'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { HoverCard, HoverCardTrigger, HoverCardContent } from './ui/hover-card'
import { resolveRacLogic } from '@/lib/logic'
import { useAddToFilter } from '@/lib/use-add-to-filter'

function getNodeRole(content: NodeContent): string {
  if (content.type === 'entity') return 'entity'
  return content.role
}

export const NODE_TYPE_CONFIG: Record<
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
    bg: 'bg-blue-100',
    border: 'border-blue-400',
    label: 'Input',
    badgeBg: 'bg-blue-200 text-blue-800',
  },
  constant: {
    icon: BookOpen,
    bg: 'bg-gray-100',
    border: 'border-gray-300',
    label: 'Constant',
    badgeBg: 'bg-gray-200 text-gray-700',
  },
  computed: {
    icon: GitBranch,
    bg: 'bg-violet-100',
    border: 'border-violet-300',
    label: 'Computed',
    badgeBg: 'bg-violet-200 text-violet-800',
  },
  entity: {
    icon: Box,
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    label: 'Entity',
    badgeBg: 'bg-amber-100 text-amber-800',
  },
}

const DEFAULT_CONFIG = {
  icon: Box,
  bg: 'bg-gray-100',
  border: 'border-gray-300',
  label: 'Node',
  badgeBg: 'bg-gray-200 text-gray-700',
}

type NodeProps = {
  node: ModelNode
}

// Element IDs are scoped by rulesetId so multiple tabs can coexist in the
// DOM without getElementById collisions (rulesets can share node names like
// "eligible" or "income_eligible").
export function nodeElementId(rulesetId: string, id: string) {
  return `node-${rulesetId}-${id}`
}

// Use shared format utilities
import { formatBadgeValue as formatResultValue } from '@/lib/format'

export function Node({ node }: NodeProps) {
  const {
    model,
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
    entityData,
    setEntityData,
  } = useMainContext()

  const [isHovered, setIsHovered] = useState(false)
  const [collectionEditorOpen, setCollectionEditorOpen] = useState(false)
  const result = executionResults?.[node.id]
  const overrideValue = inputOverrides[node.id] ?? ''
  const isInput = isInputNode(node)
  const collectionInfo = getCollectionInfo(node)
  const isCollection = !!collectionInfo || isCollectionParent(node)
  const isEditable = isOverridable(node) && !isCollection

  // For collection-scoped nodes, any row with a non-empty value for this
  // node's field counts as an override (derived) or an input value (input).
  const collectionFieldPath = collectionInfo
    ? getCollectionFieldKey(node)
    : undefined
  const hasCollectionValue =
    isCollection && collectionInfo && collectionFieldPath
      ? (entityData[collectionInfo.collection] ?? []).some(
          (row) => row[collectionFieldPath] !== undefined && row[collectionFieldPath] !== ''
        )
      : false
  const hasOverride = isCollection
    ? hasCollectionValue
    : overrideValue !== ''
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
      className={cn(config.bg, 'relative z-10 h-full')}
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
              ? 'border-blue-500 ring-1 ring-blue-500'
              : 'border-yellow-400 ring-1 ring-yellow-400'
            : config.border,
          'border h-full relative flex flex-col items-center p-4'
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
              return `per ${getCollectionDisplayName(info.collection)}`
            })()}
          </span>
        )}

        {/* Input nodes in test mode: show test value as read-only badge */}
        {isInput &&
          !isCollection &&
          activeTest?.inputs &&
          (() => {
            const nodePath =
              node.content.type !== 'entity' ? node.content.path : null
            const testValue = nodePath
              ? activeTest?.inputs[nodePath]
              : undefined
            if (testValue !== undefined) {
              return (
                <div className="mt-1.5 font-mono text-xs text-blue-800 bg-blue-100 rounded px-2 py-0.5 border border-blue-300">
                  {formatResultValue(testValue)}
                </div>
              )
            }
            return null
          })()}

        {/* Input nodes: prominent field, always visible (but not for collection-scoped) */}
        {isInput && !isCollection && (
          <div
            className={cn(
              'mt-1.5 flex items-center gap-1 h-6',
              activeTest && 'invisible'
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <Input
              className={cn(
                'h-6 w-28 text-xs font-mono text-center',
                hasOverride
                  ? 'border-blue-500 ring-1 ring-blue-500'
                  : 'border-blue-400'
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

        {/* Collection-scoped nodes: edit-members button mirrors the scalar
            input/override affordance — always visible for inputs and while
            any override value is set, hover-only otherwise. */}
        {isCollection && !isCollectionParent(node) && collectionInfo && (
          <div
            className={cn(
              'mt-1.5 flex items-center gap-1 h-6',
              activeTest && 'invisible',
              !activeTest &&
                !isInput &&
                !hasOverride &&
                !isHovered &&
                'invisible'
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className={cn(
                'h-6 px-2 rounded border text-[11px] flex items-center gap-1',
                hasOverride
                  ? isInput
                    ? 'border-blue-500 ring-1 ring-blue-500'
                    : 'border-dashed border-yellow-400 ring-1 ring-yellow-400'
                  : isInput
                    ? 'border-blue-400'
                    : 'border-dashed border-muted-foreground/40 text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
              onClick={() => setCollectionEditorOpen(true)}
            >
              <Plus className="size-3" />
              Edit members
            </button>
            {hasOverride && collectionFieldPath && (
              <button
                className="text-muted-foreground hover:text-foreground"
                title={isInput ? 'Clear values' : 'Clear override'}
                onClick={() => {
                  setEntityData((prev) => {
                    const rows = prev[collectionInfo.collection] ?? []
                    const cleared = rows.map((row) => {
                      const next = { ...row }
                      delete next[collectionFieldPath]
                      return next
                    })
                    return { ...prev, [collectionInfo.collection]: cleared }
                  })
                  runOnBlur()
                }}
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
              'mt-1.5 flex items-center gap-1 h-6',
              (activeTest || (!hasOverride && !isHovered)) && 'invisible'
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <Input
              className={cn(
                'h-6 w-20 text-xs font-mono text-center border-dashed',
                hasOverride
                  ? 'border-yellow-400 ring-1 ring-yellow-400'
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
          const nodePath =
            node.content.type !== 'entity' ? node.content.path : null
          const testExp =
            nodePath && activeTest ? activeTest.expectations[nodePath] : null

          // In test mode: always show the computed value (same sky styling
          // as a normal execution result). For asserted nodes, add a
          // pass/fail indicator; failing nodes also show the expected value.
          if (activeTest && nodePath) {
            const computed =
              testExp?.actual ?? activeTest.computedValues?.[nodePath]
            if (computed === undefined) return null

            const passed = testExp?.passed
            const failed = testExp && !passed

            return (
              <div
                className={cn(
                  'mt-2 font-mono rounded px-2 py-0.5 max-w-44 text-center text-xs border',
                  failed
                    ? 'bg-orange-100 text-orange-800 border-orange-300'
                    : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                )}
              >
                <div className="flex items-center gap-1 justify-center">
                  {testExp && passed && (
                    <CheckCircle className="size-3 text-emerald-700 shrink-0" />
                  )}
                  {failed && (
                    <XCircle className="size-3 text-orange-700 shrink-0" />
                  )}
                  <span className="truncate">
                    {formatResultValue(computed)}
                  </span>
                </div>
                {failed && (
                  <div className="text-[10px] text-orange-600 truncate">
                    expected {formatResultValue(testExp.expected)}
                  </div>
                )}
              </div>
            )
          }

          // Normal execution result (non-test mode)
          if (result && !activeTest) {
            const badgeClasses = cn(
              'mt-2 font-mono rounded px-2 py-0.5 truncate max-w-36 text-center',
              'text-xs bg-emerald-100 text-emerald-800 border border-emerald-300'
            )
            if (isCollection && collectionInfo) {
              return (
                <button
                  className={cn(
                    badgeClasses,
                    'hover:bg-emerald-200 hover:border-emerald-400'
                  )}
                  title="Edit members"
                  onClick={(e) => {
                    e.stopPropagation()
                    setCollectionEditorOpen(true)
                  }}
                >
                  {formatResultValue(result.value)}
                </button>
              )
            }
            return <div className={badgeClasses}>{formatResultValue(result.value)}</div>
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
      {isCollection && collectionInfo && (
        <CollectionEditorDialog
          open={collectionEditorOpen}
          onOpenChange={setCollectionEditorOpen}
          collection={collectionInfo.collection}
          fieldPath={collectionFieldPath}
          fieldLabel={node.name}
          nodes={model.nodes}
          entityData={entityData}
          setEntityData={setEntityData}
          onBlur={runOnBlur}
          results={executionResults}
        />
      )}
    </div>
  )
}

type CollectionEditorDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  collection: string
  /** Restrict the editor to a single field path (e.g. "isElderly"). */
  fieldPath?: string
  fieldLabel?: string
  nodes: Record<string, ModelNode>
  entityData: Record<string, Record<string, string>[]>
  setEntityData: (
    updater: (prev: Record<string, Record<string, string>[]>) => Record<string, Record<string, string>[]>
  ) => void
  onBlur: () => void
  results?: Record<string, { value: unknown }> | null
}

function CollectionEditorDialog({
  open,
  onOpenChange,
  collection,
  fieldPath,
  fieldLabel,
  nodes,
  entityData,
  setEntityData,
  onBlur,
  results,
}: CollectionEditorDialogProps) {
  const allFields = getCollectionOverridableFields(nodes)[collection] ?? []
  const fields = fieldPath
    ? allFields.filter((f) => f.path === fieldPath)
    : allFields
  const rows = entityData[collection] ?? []
  const collectionLabel = getCollectionDisplayName(collection)
  const title = fieldLabel
    ? `${fieldLabel} · ${collectionLabel}`
    : collectionLabel
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto pr-1">
          {fields.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">
              No editable field for this node.
            </p>
          ) : (
            <EntityEditor
              entityName={collection}
              fields={fields}
              rows={rows}
              onChange={(newRows) =>
                setEntityData((prev) => ({ ...prev, [collection]: newRows }))
              }
              onBlur={onBlur}
              results={results}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
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

      {/* Policy references */}
      <PolicyReferencesList node={node} />
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

// Find the pan-container of the currently visible tab.
// Multiple tabs may be mounted simultaneously (hidden via display:none);
// offsetParent === null means the element is hidden.
function findVisiblePanContainer(): HTMLElement | null {
  const containers = document.querySelectorAll('[data-pan-container]')
  for (const el of containers) {
    const htmlEl = el as HTMLElement
    if (htmlEl.offsetParent !== null) return htmlEl
  }
  return (containers[0] as HTMLElement | undefined) ?? null
}

const VIEWPORT_MARGIN = 400

function updateViewportNow() {
  const container = findVisiblePanContainer()
  if (!container) return
  const rect = container.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return
  const inner = container.firstElementChild as HTMLElement | null
  if (!inner) return
  const style = getComputedStyle(inner)
  const matrix = new DOMMatrix(style.transform)
  const scale = matrix.a || 1
  const offsetX = matrix.e
  const offsetY = matrix.f
  currentViewport = {
    top: (-offsetY - VIEWPORT_MARGIN) / scale,
    left: (-offsetX - VIEWPORT_MARGIN) / scale,
    bottom: (-offsetY + rect.height + VIEWPORT_MARGIN) / scale,
    right: (-offsetX + rect.width + VIEWPORT_MARGIN) / scale,
  }
  for (const cb of viewportListeners) cb()
}

// One global listener that updates the viewport on layout-affecting events.
if (typeof window !== 'undefined') {
  window.addEventListener('transform', updateViewportNow)
  window.addEventListener('resize', updateViewportNow)
  window.addEventListener('containerresize', updateViewportNow)
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
    top + h > vp.top && top < vp.bottom && left + w > vp.left && left < vp.right
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
    return () => {
      viewportListeners.delete(update)
    }
  }, [ref, size])

  return visible
}

export function Rows({ rows }: RowsProps) {
  // After layout changes, refresh the viewport (and thus virtualization)
  // based on the current DOM. Runs after child VirtualNode effects so we
  // overwrite their reads of the stale module-level viewport.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      updateViewportNow()
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
  const { model, rulesetId } = useMainContext()
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
      id={nodeElementId(rulesetId, id)}
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

function PolicyReferencesList({ node }: { node: ModelNode }) {
  const { model, refreshModel, openPolicyAtPage } = useMainContext()
  const references = node.references ?? []
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [manifest, setManifest] = useState<PolicyReferences | null>(null)
  const [addMode, setAddMode] = useState<'pick' | 'new'>('pick')
  const [newDocTitle, setNewDocTitle] = useState('')
  const [newDocUrl, setNewDocUrl] = useState('')
  const [newDocFile, setNewDocFile] = useState('')
  const [newSectionLabel, setNewSectionLabel] = useState('')
  const [newSectionText, setNewSectionText] = useState('')
  const [selectedDocId, setSelectedDocId] = useState('')
  const [selectedSectionId, setSelectedSectionId] = useState('')
  const [saving, setSaving] = useState(false)

  const nodePath = getNodePath(node.content)

  const toggle = (sectionId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }

  const openAdd = async () => {
    try {
      const refs = await getReferences(model.id)
      setManifest(refs)
      setAdding(true)
      setAddMode(refs.sections.length > 0 ? 'pick' : 'new')
      setSelectedDocId(refs.documents[0]?.id ?? '')
      setSelectedSectionId('')
    } catch (e) {
      console.error('Failed to load references:', e)
    }
  }

  const cancelAdd = () => {
    setAdding(false)
    setNewDocTitle('')
    setNewDocUrl('')
    setNewDocFile('')
    setNewSectionLabel('')
    setNewSectionText('')
  }

  const handleAdd = async () => {
    if (!manifest || !nodePath) return
    setSaving(true)
    try {
      const updated = { ...manifest }
      let sectionId = selectedSectionId

      if (addMode === 'new') {
        // Create document if needed
        let docId = selectedDocId
        if (!docId && newDocTitle.trim()) {
          docId = newDocTitle
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
          updated.documents = [
            ...updated.documents,
            {
              id: docId,
              title: newDocTitle.trim(),
              url: newDocUrl.trim() || undefined,
              file: newDocFile.trim() || undefined,
            },
          ]
        }
        if (!docId) return

        // Create section
        sectionId = `${docId}__${newSectionLabel
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9.]+/g, '-')}`
        updated.sections = [
          ...updated.sections,
          {
            id: sectionId,
            documentId: docId,
            label: newSectionLabel.trim(),
            text: newSectionText.trim(),
          },
        ]
      }

      if (!sectionId) return

      // Add mapping
      updated.mappings = [...updated.mappings, { nodePath, sectionId }]

      await saveReferences(model.id, updated)
      refreshModel()
      cancelAdd()
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async (sectionId: string) => {
    if (!nodePath) return
    setSaving(true)
    try {
      const refs = await getReferences(model.id)
      refs.mappings = refs.mappings.filter(
        (m) => !(m.nodePath === nodePath && m.sectionId === sectionId)
      )
      await saveReferences(model.id, refs)
      refreshModel()
    } finally {
      setSaving(false)
    }
  }

  // Group by document
  const byDocument = new Map<string, ResolvedReference[]>()
  for (const ref of references) {
    const list = byDocument.get(ref.document.id) ?? []
    list.push(ref)
    byDocument.set(ref.document.id, list)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <BookOpen className="size-3.5" />
          Policy
        </label>
        {!adding && (
          <button
            className="p-0.5 text-muted-foreground hover:text-foreground"
            onClick={openAdd}
            title="Link policy section"
          >
            <Plus className="size-3" />
          </button>
        )}
      </div>

      {references.length === 0 && !adding && (
        <span className="text-[10px] text-muted-foreground italic">
          No policy references linked
        </span>
      )}

      <div className="flex flex-col gap-2">
        {Array.from(byDocument.entries()).map(([docId, refs]) => (
          <div key={docId} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              {refs[0].document.file ? (
                <FileText className="size-2.5 shrink-0" />
              ) : null}
              {refs[0].document.url ? (
                <a
                  href={refs[0].document.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground flex items-center gap-1"
                >
                  {refs[0].document.title}
                  <ExternalLink className="size-2.5" />
                </a>
              ) : (
                <span>{refs[0].document.title}</span>
              )}
            </div>
            {refs.map((ref) => {
              const isOpen = expanded.has(ref.section.id)
              return (
                <div
                  key={ref.section.id}
                  className="border rounded-md px-3 py-2 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <button
                      className="flex items-center gap-1.5 flex-1 text-left"
                      onClick={() => toggle(ref.section.id)}
                    >
                      {isOpen ? (
                        <ChevronDown className="size-3 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="size-3 text-muted-foreground shrink-0" />
                      )}
                      <span className="text-xs font-medium">
                        {ref.section.label}
                      </span>
                    </button>
                    {ref.section.page && (
                      <button
                        className="p-0.5 text-muted-foreground hover:text-blue-600 shrink-0"
                        onClick={() =>
                          openPolicyAtPage(ref.section.page!, [ref.section.id])
                        }
                        title={`View in PDF (page ${ref.section.page})`}
                      >
                        <FileText className="size-3" />
                      </button>
                    )}
                    <button
                      className="p-0.5 text-muted-foreground hover:text-red-600 shrink-0"
                      onClick={() => handleRemove(ref.section.id)}
                      disabled={saving}
                      title="Remove reference"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                  {isOpen && (
                    <p className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed ml-[18px]">
                      {ref.section.text}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Add reference form */}
      {adding && manifest && (
        <div className="border rounded-md p-3 space-y-2 bg-muted/30">
          <div className="flex gap-1.5 text-[10px]">
            <button
              className={cn(
                'px-2 py-0.5 rounded',
                addMode === 'pick'
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setAddMode('pick')}
            >
              Existing section
            </button>
            <button
              className={cn(
                'px-2 py-0.5 rounded',
                addMode === 'new'
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setAddMode('new')}
            >
              New section
            </button>
          </div>

          {addMode === 'pick' ? (
            <div className="space-y-1.5">
              <select
                className="w-full h-7 text-xs border rounded px-2 bg-background"
                value={selectedSectionId}
                onChange={(e) => setSelectedSectionId(e.target.value)}
              >
                <option value="">Select a section...</option>
                {manifest.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-1.5">
              {manifest.documents.length > 0 ? (
                <select
                  className="w-full h-7 text-xs border rounded px-2 bg-background"
                  value={selectedDocId}
                  onChange={(e) => setSelectedDocId(e.target.value)}
                >
                  <option value="">New document...</option>
                  {manifest.documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              ) : null}
              {!selectedDocId && (
                <>
                  <Input
                    className="h-7 text-xs"
                    placeholder="Document title"
                    value={newDocTitle}
                    onChange={(e) => setNewDocTitle(e.target.value)}
                  />
                  <Input
                    className="h-7 text-xs"
                    placeholder="Document URL (optional)"
                    value={newDocUrl}
                    onChange={(e) => setNewDocUrl(e.target.value)}
                  />
                  <Input
                    className="h-7 text-xs"
                    placeholder="PDF file path (optional, e.g. policy/snap.pdf)"
                    value={newDocFile}
                    onChange={(e) => setNewDocFile(e.target.value)}
                  />
                </>
              )}
              <Input
                className="h-7 text-xs"
                placeholder="Section label (e.g. 4.407.2 — Earned Income Deduction)"
                value={newSectionLabel}
                onChange={(e) => setNewSectionLabel(e.target.value)}
              />
              <textarea
                className="w-full text-xs border rounded px-2 py-1.5 bg-background resize-y min-h-[60px]"
                placeholder="Paste the policy text for this section..."
                rows={4}
                value={newSectionText}
                onChange={(e) => setNewSectionText(e.target.value)}
              />
            </div>
          )}

          <div className="flex gap-1.5 justify-end">
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[11px]"
              onClick={cancelAdd}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-6 text-[11px]"
              onClick={handleAdd}
              disabled={
                saving ||
                (addMode === 'pick' && !selectedSectionId) ||
                (addMode === 'new' &&
                  (!newSectionLabel.trim() || !newSectionText.trim()))
              }
            >
              {saving ? 'Saving...' : 'Link'}
            </Button>
          </div>
        </div>
      )}
    </div>
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
        <span className="text-emerald-700 flex items-center gap-1">
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
    selectedNodes,
    setSelectedNodes,
    entityData,
    setEntityData,
  } = useMainContext()
  const addToFilter = useAddToFilter()
  const openNodeData = useFindNode(openNode)

  if (openNode === null || openNodeData === undefined) {
    return null
  }

  const inWorkspace = workspaceItems.includes(openNode)
  const inFilter = selectedNodes.includes(openNode)
  const isInput = isInputNode(openNodeData)
  const isConstant = isConstantNode(openNodeData)
  const panelCollectionInfo = getCollectionInfo(openNodeData)
  const panelIsCollection =
    !!panelCollectionInfo || isCollectionParent(openNodeData)
  const panelFieldPath = panelCollectionInfo
    ? getCollectionFieldKey(openNodeData)
    : undefined
  const canEdit = isOverridable(openNodeData) && !panelIsCollection

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
                <ContextMenu.Separator className="h-px my-1 bg-border" />
                <ContextMenu.Item
                  className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
                  onSelect={() => {
                    const direct = new Set(
                      openNodeData.dependencies.filter((id) => model.nodes[id])
                    )
                    setWorkspaceItems((prev) =>
                      prev.filter((id) => id !== openNode && !direct.has(id))
                    )
                  }}
                >
                  Remove with dependencies (
                  {
                    openNodeData.dependencies.filter((id) => model.nodes[id])
                      .length
                  }
                  )
                </ContextMenu.Item>
                <ContextMenu.Item
                  className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
                  onSelect={() => {
                    const direct = new Set(getDependents(openNode, model.nodes))
                    setWorkspaceItems((prev) =>
                      prev.filter((id) => id !== openNode && !direct.has(id))
                    )
                  }}
                >
                  Remove with dependents (
                  {getDependents(openNode, model.nodes).length})
                </ContextMenu.Item>
                <ContextMenu.Separator className="h-px my-1 bg-border" />
                <ContextMenu.Item
                  className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
                  onSelect={() => {
                    const deps = new Set(
                      getAllDependencies(openNode, model.nodes)
                    )
                    setWorkspaceItems((prev) =>
                      prev.filter((id) => id !== openNode && !deps.has(id))
                    )
                  }}
                >
                  Remove with all dependencies (
                  {getAllDependencies(openNode, model.nodes).length})
                </ContextMenu.Item>
                <ContextMenu.Item
                  className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
                  onSelect={() => {
                    const deps = new Set(
                      getAllDependents(openNode, model.nodes)
                    )
                    setWorkspaceItems((prev) =>
                      prev.filter((id) => id !== openNode && !deps.has(id))
                    )
                  }}
                >
                  Remove with all dependents (
                  {getAllDependents(openNode, model.nodes).length})
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={inFilter ? 'Remove from filter (F)' : 'Add to filter (F)'}
            onClick={() =>
              inFilter
                ? setSelectedNodes((prev) =>
                    prev.filter((id) => id !== openNode)
                  )
                : addToFilter(openNode)
            }
          >
            {inFilter ? (
              <FilterX className="size-4 text-primary" />
            ) : (
              <Filter className="size-4" />
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

        {/* Full member editor (same layout as the Inputs panel) when the
            open node is collection-scoped. */}
        {panelIsCollection &&
          panelCollectionInfo &&
          !isCollectionParent(openNodeData) &&
          (() => {
            const collection = panelCollectionInfo.collection
            const fields =
              getCollectionOverridableFields(model.nodes)[collection] ?? []
            if (fields.length === 0) return null
            const rows = entityData[collection] ?? []
            return (
              <div className="mt-6">
                <EntityEditor
                  entityName={collection}
                  fields={fields}
                  rows={rows}
                  onChange={(newRows) =>
                    setEntityData((prev) => ({
                      ...prev,
                      [collection]: newRows,
                    }))
                  }
                  onBlur={runOnBlur}
                  results={executionResults}
                />
              </div>
            )
          })()}

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
                      ? 'border-blue-500 ring-1 ring-blue-500'
                      : 'border-yellow-400 ring-1 ring-yellow-400')
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
            <pre className="text-sm bg-emerald-100 text-emerald-800 rounded-md p-3 overflow-x-auto">
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
