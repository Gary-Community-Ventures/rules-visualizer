import { useState } from 'react'
import type { ModelNode, NodeLink } from '@/lib/model'
import { createLink } from '@/lib/model'
import { useUpdateNode, useUpdateDiff } from '@/context'
import { Button } from '../ui/button'
import { Table, TableRow, TableInputCell, TableLinkCell } from '../table'
import { Plus, ChevronRight, PlusIcon, ArrowUpIcon, ArrowDownIcon, TrashIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type NodeDocumentationProps = {
  node: ModelNode
  diff?: ModelNode
}

export function NodeDocumentation({ node, diff }: NodeDocumentationProps) {
  const updateNode = useUpdateNode()
  const updateDiff = useUpdateDiff()

  const hasDiff = diff !== undefined

  const links = node.links ?? []
  const diffLinks = diff?.links ?? []
  const activeLinks = hasDiff ? diffLinks : links

  const oldDescription = node.description ?? ''
  const activeDescription = hasDiff ? (diff.description ?? '') : oldDescription

  const descriptionChanged = hasDiff && activeDescription !== oldDescription
  const linksChanged = hasDiff && JSON.stringify(diffLinks) !== JSON.stringify(links)

  const [collapsed, setCollapsed] = useState(
    !(hasDiff && (descriptionChanged || linksChanged))
  )

  const hasContent = activeDescription !== '' || activeLinks.length > 0

  const updateDescription = (value: string) => {
    if (hasDiff) {
      updateDiff(node.id, (d) => ({ ...d, description: value }))
    } else {
      updateNode(node.id, (n) => ({ ...n, description: value }))
    }
  }

  const updateLinks = (updater: (links: NodeLink[]) => NodeLink[]) => {
    if (hasDiff) {
      updateDiff(node.id, (d) => ({ ...d, links: updater(d.links ?? []) }))
    } else {
      updateNode(node.id, (n) => ({ ...n, links: updater(n.links ?? []) }))
    }
  }

  // For diff mode: compute removed links and old links map
  const oldLinksById = new Map(links.map((l) => [l.id, l]))
  const diffLinkIds = new Set(diffLinks.map((l) => l.id))
  const removedLinks = hasDiff ? links.filter((l) => !diffLinkIds.has(l.id)) : []

  const getLinksActions = (_x: number, y: number) => {
    // In diff mode, skip removed links rows
    const linkIndex = hasDiff ? y - removedLinks.length : y
    if (linkIndex < 0) return []

    const link = activeLinks[linkIndex]
    if (!link) return []

    const isFirst = linkIndex === 0
    const isLast = linkIndex === activeLinks.length - 1

    const insertActions = [
      {
        name: 'Insert row above',
        Icon: PlusIcon,
        action: () =>
          updateLinks((prev) => {
            const next = [...prev]
            next.splice(linkIndex, 0, createLink())
            return next
          }),
      },
      {
        name: 'Insert row below',
        Icon: PlusIcon,
        action: () =>
          updateLinks((prev) => {
            const next = [...prev]
            next.splice(linkIndex + 1, 0, createLink())
            return next
          }),
      },
    ]

    const shiftActions = [
      ...(!isFirst
        ? [
            {
              name: 'Shift up',
              Icon: ArrowUpIcon,
              action: () =>
                updateLinks((prev) => {
                  const next = [...prev]
                  const temp = next[linkIndex - 1]
                  next[linkIndex - 1] = next[linkIndex]
                  next[linkIndex] = temp
                  return next
                }),
            },
          ]
        : []),
      ...(!isLast
        ? [
            {
              name: 'Shift down',
              Icon: ArrowDownIcon,
              action: () =>
                updateLinks((prev) => {
                  const next = [...prev]
                  const temp = next[linkIndex]
                  next[linkIndex] = next[linkIndex + 1]
                  next[linkIndex + 1] = temp
                  return next
                }),
            },
          ]
        : []),
    ]

    const deleteActions = [
      {
        name: 'Delete row',
        Icon: TrashIcon,
        variant: 'destructive' as const,
        action: () => updateLinks((prev) => prev.filter((l) => l.id !== link.id)),
      },
    ]

    return [
      insertActions,
      ...(shiftActions.length > 0 ? [shiftActions] : []),
      deleteActions,
    ]
  }

  return (
    <div className="flex flex-col gap-2">
      <Header
        hasContent={hasContent}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
      />
      {!collapsed && (
        <div className="flex flex-col gap-3">
          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground font-medium">
              Description
            </span>
            <Table columns={hasDiff ? 2 : 1}>
              <TableRow>
                {hasDiff && (
                  <TableInputCell
                    value={oldDescription}
                    onChange={() => {}}
                    disabled
                    className="bg-gray-100"
                  />
                )}
                <TableInputCell
                  value={activeDescription}
                  onChange={updateDescription}
                  className={descriptionChanged ? 'bg-emerald-100' : ''}
                />
              </TableRow>
            </Table>
          </div>

          {/* Links */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground font-medium">
              Links
            </span>
            <Table columns={hasDiff ? 4 : 2} getActions={getLinksActions}>
              {/* Removed links (diff mode only) */}
              {removedLinks.map((link) => (
                <TableRow key={`removed-${link.id}`}>
                  <TableInputCell
                    value={link.label}
                    onChange={() => {}}
                    disabled
                    className="bg-red-100 line-through opacity-60"
                  />
                  <TableInputCell
                    value=""
                    onChange={() => {}}
                    disabled
                    className="bg-gray-50"
                  />
                  <TableLinkCell
                    value={link.url}
                    onChange={() => {}}
                    disabled
                    className="bg-red-100 line-through opacity-60"
                  />
                  <TableLinkCell
                    value=""
                    onChange={() => {}}
                    disabled
                    className="bg-gray-50"
                  />
                </TableRow>
              ))}
              {/* Active links */}
              {activeLinks.map((link) => {
                const oldLink = oldLinksById.get(link.id)
                const isNew = hasDiff && !oldLink
                const labelChanged = hasDiff && oldLink && oldLink.label !== link.label
                const urlChanged = hasDiff && oldLink && oldLink.url !== link.url

                return (
                  <TableRow key={link.id}>
                    {hasDiff && (
                      <TableInputCell
                        value={oldLink?.label ?? ''}
                        onChange={() => {}}
                        disabled
                        className="bg-gray-100"
                      />
                    )}
                    <TableInputCell
                      value={link.label}
                      onChange={(v) =>
                        updateLinks((prev) =>
                          prev.map((l) =>
                            l.id === link.id ? { ...l, label: v } : l
                          )
                        )
                      }
                      className={isNew || labelChanged ? 'bg-emerald-100' : ''}
                    />
                    {hasDiff && (
                      <TableLinkCell
                        value={oldLink?.url ?? ''}
                        onChange={() => {}}
                        disabled
                        className="bg-gray-100"
                      />
                    )}
                    <TableLinkCell
                      value={link.url}
                      onChange={(v) =>
                        updateLinks((prev) =>
                          prev.map((l) =>
                            l.id === link.id ? { ...l, url: v } : l
                          )
                        )
                      }
                      className={isNew || urlChanged ? 'bg-emerald-100' : ''}
                    />
                  </TableRow>
                )
              })}
            </Table>
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateLinks((prev) => [...prev, createLink()])}
            >
              <Plus className="size-3.5 mr-1" />
              Add Link
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Shared sub-components ────────────────────────────────────────────

function Header({
  hasContent,
  collapsed,
  onToggle,
}: {
  hasContent: boolean
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
      onClick={onToggle}
    >
      <ChevronRight
        className={cn(
          'size-3.5 transition-transform',
          !collapsed && 'rotate-90'
        )}
      />
      Documentation
      {hasContent && collapsed && (
        <span className="size-1.5 rounded-full bg-muted-foreground/50" />
      )}
    </button>
  )
}
