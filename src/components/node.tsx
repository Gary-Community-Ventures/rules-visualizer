import { useState } from 'react'
import {
  useAddNode,
  useDeleteNode,
  useDiff,
  useFindNode,
  useMainContext,
  useResolveDiff,
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
  Check,
  Copy,
  EllipsisVertical,
  Trash2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Editor } from './inputs/editor'
import { NodeInput } from './node-input'
import { NodeResultBadge } from './node-result'
import { TextInput } from './inputs/text'
import { NodeTests } from './inputs/node-tests'
import { NodeDocumentation } from './inputs/node-documentation'
import { cloneContent, generateId, uniqueName, type ModelNode } from '@/lib/model'
import { getDependents } from '@/lib/graph'
import { useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

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

    if (alreadyExists && diff !== undefined) {
      return 'border-blue-400 border-2'
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
  const { model } = useMainContext()
  const updateNode = useUpdateNode()
  const diff = useDiff(node.id)
  const updateDiff = useUpdateDiff()

  const config = NODE_TYPE_CONFIG[node.content.type]
  const Icon = config.icon

  // Determine if this is a new, deleted, or modified node
  const isNewNode = model.nodes[node.id] === undefined && diff !== undefined
  const isDeletedNode = diff?.deletedVersion !== undefined
  const isModifiedNode = model.nodes[node.id] !== undefined && diff !== undefined && !isDeletedNode

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
        {isNewNode && (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700">
            New
          </span>
        )}
        {isDeletedNode && (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700">
            Deleted
          </span>
        )}
        {isModifiedNode && (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700">
            Modified
          </span>
        )}
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

      {/* Documentation section */}
      <NodeDocumentation node={node} diff={diff} />

      {/* Content section */}
      <Editor node={node} />
      {/* Tests section (decision and decision table nodes only) */}
      {node.content.type !== 'input' && node.content.type !== 'constant' && (
        <NodeTests node={node} allNodes={model.nodes} diff={diff} />
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

export function NodePanel() {
  const { model, openNode, setOpenNode, setSelectedNodes } = useMainContext()
  const addNode = useAddNode()
  const deleteNode = useDeleteNode()
  const openNodeData = useFindNode(openNode)
  const diff = useDiff(openNode ?? '')
  const resolveDiff = useResolveDiff()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  if (openNode === null || openNodeData === undefined) {
    return null
  }

  const dependentIds = getDependents(openNode, model.nodes)
  const dependentNames = dependentIds.map((id) => model.nodes[id]?.name ?? id)

  const isNewNode = model.nodes[openNode] === undefined && diff !== undefined
  const isDeletedNode = diff?.deletedVersion !== undefined
  const isModifiedNode = model.nodes[openNode] !== undefined && diff !== undefined && !isDeletedNode

  const handleDelete = () => {
    setSelectedNodes((prev) => prev.filter((id) => id !== openNode))
    setOpenNode(null)
    deleteNode(openNode)
    setShowDeleteDialog(false)
  }

  const handleDuplicate = () => {
    const existingNames = new Set(Object.values(model.nodes).map((n) => n.name))
    const newId = generateId()
    const newName = uniqueName(openNodeData.name, existingNames)
    addNode(newId, {
      id: newId,
      name: newName,
      typeRef: openNodeData.typeRef,
      dependencies: [],
      content: cloneContent(openNodeData.content),
    })
    setOpenNode(newId)
  }

  return (
    <>
      <div className="flex flex-col h-full bg-background">
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <h2 className="text-sm font-semibold">Edit Node</h2>
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <EllipsisVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={handleDuplicate}>
                  <Copy className="size-4" />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setShowDeleteDialog(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="size-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
        <div
          className={cn(
            'flex-1 overflow-y-auto p-5',
            isNewNode && 'bg-emerald-50 border-l-4 border-emerald-400',
            isDeletedNode && 'bg-red-50 border-l-4 border-red-400'
          )}
        >
          <NodeViewer node={openNodeData} />
        </div>
        {diff !== undefined && (
          <div className="shrink-0 border-t p-4 flex gap-2">
            <Button
              variant="outline"
              className="flex-1 text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={() => resolveDiff(openNode, false)}
            >
              <X className="size-4 mr-2" />
              Reject
            </Button>
            <Button
              variant="outline"
              className="flex-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
              onClick={() => resolveDiff(openNode, true)}
            >
              <Check className="size-4 mr-2" />
              Accept
            </Button>
          </div>
        )}
      </div>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete "{openNodeData.name}"?</DialogTitle>
            <DialogDescription>
              This will permanently remove this node from the model.
            </DialogDescription>
          </DialogHeader>
          {dependentNames.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-800">
                The following nodes reference this node:
              </p>
              <ul className="mt-1.5 list-disc list-inside text-sm text-amber-700">
                {dependentNames.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs text-amber-600">
                Their dependency arrows will be removed.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
