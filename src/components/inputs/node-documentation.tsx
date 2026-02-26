import { useState } from 'react'
import type { ModelNode, NodeLink } from '@/lib/model'
import { createLink } from '@/lib/model'
import { useUpdateNode, useUpdateDiff } from '@/context'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Plus, Trash2, ChevronRight } from 'lucide-react'
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

  const descriptionChanged =
    hasDiff && (diff.description ?? '') !== (node.description ?? '')
  const linksChanged =
    hasDiff && JSON.stringify(diffLinks) !== JSON.stringify(links)

  // Expand by default if there's a diff with documentation changes
  const [collapsed, setCollapsed] = useState(
    !(hasDiff && (descriptionChanged || linksChanged))
  )

  const activeDescription = hasDiff
    ? (diff.description ?? '')
    : (node.description ?? '')
  const hasContent = activeDescription !== '' || activeLinks.length > 0

  const linkCount = activeLinks.length
  let headerLabel = 'Documentation'
  if (linkCount > 0) {
    headerLabel = `Documentation (${linkCount} links)`
  }

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

  // ─── Diff mode: merge links by ID ────────────────────────────────
  if (hasDiff) {
    const oldDescription = node.description ?? ''
    const oldLinksById = new Map(links.map((l) => [l.id, l]))
    const diffLinkIds = new Set(diffLinks.map((l) => l.id))

    // Removed links: in original but not in diff
    const removedLinks = links.filter((l) => !diffLinkIds.has(l.id))

    return (
      <div className="flex flex-col gap-2">
        <Header
          label={headerLabel}
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
              {descriptionChanged && oldDescription && (
                <span className="text-xs text-muted-foreground line-through">
                  {oldDescription}
                </span>
              )}
              <Textarea
                placeholder="Add a description..."
                value={activeDescription}
                onChange={(e) => updateDescription(e.target.value)}
                className={cn(
                  'text-sm min-h-[60px]',
                  descriptionChanged && 'bg-emerald-100'
                )}
              />
            </div>

            {/* Links */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground font-medium">
                Links
              </span>
              {removedLinks.map((link) => (
                <LinkRow
                  key={`removed-${link.id}`}
                  link={link}
                  disabled
                  strikethrough
                  className="opacity-60"
                />
              ))}
              {diffLinks.map((link) => {
                const oldLink = oldLinksById.get(link.id)
                const isNew = !oldLink
                const labelChanged = oldLink !== undefined && oldLink.label !== link.label
                const urlChanged = oldLink !== undefined && oldLink.url !== link.url

                return (
                  <LinkRow
                    key={link.id}
                    link={link}
                    oldLink={oldLink}
                    labelHighlight={isNew || labelChanged}
                    urlHighlight={isNew || urlChanged}
                    onLabelChange={(value) =>
                      updateLinks((prev) =>
                        prev.map((l) =>
                          l.id === link.id ? { ...l, label: value } : l
                        )
                      )
                    }
                    onUrlChange={(value) =>
                      updateLinks((prev) =>
                        prev.map((l) =>
                          l.id === link.id ? { ...l, url: value } : l
                        )
                      )
                    }
                    onDelete={() =>
                      updateLinks((prev) =>
                        prev.filter((l) => l.id !== link.id)
                      )
                    }
                  />
                )
              })}
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

  // ─── Normal mode ─────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-2">
      <Header
        label={headerLabel}
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
            <Textarea
              placeholder="Add a description..."
              value={activeDescription}
              onChange={(e) => updateDescription(e.target.value)}
              className="text-sm min-h-[60px]"
            />
          </div>

          {/* Links */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground font-medium">
              Links
            </span>
            {links.map((link) => (
              <LinkRow
                key={link.id}
                link={link}
                onLabelChange={(value) =>
                  updateLinks((prev) =>
                    prev.map((l) =>
                      l.id === link.id ? { ...l, label: value } : l
                    )
                  )
                }
                onUrlChange={(value) =>
                  updateLinks((prev) =>
                    prev.map((l) =>
                      l.id === link.id ? { ...l, url: value } : l
                    )
                  )
                }
                onDelete={() =>
                  updateLinks((prev) => prev.filter((l) => l.id !== link.id))
                }
              />
            ))}
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
  label,
  hasContent,
  collapsed,
  onToggle,
}: {
  label: string
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
      {label}
      {hasContent && collapsed && (
        <span className="size-1.5 rounded-full bg-muted-foreground/50" />
      )}
    </button>
  )
}

function LinkRow({
  link,
  oldLink,
  disabled,
  strikethrough,
  className,
  labelHighlight,
  urlHighlight,
  onLabelChange,
  onUrlChange,
  onDelete,
}: {
  link: NodeLink
  oldLink?: NodeLink
  disabled?: boolean
  strikethrough?: boolean
  className?: string
  labelHighlight?: boolean
  urlHighlight?: boolean
  onLabelChange?: (value: string) => void
  onUrlChange?: (value: string) => void
  onDelete?: () => void
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {/* Show old values struck through when modified */}
      {oldLink && (oldLink.label !== link.label || oldLink.url !== link.url) && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground line-through flex-1 truncate">
            {oldLink.label}
          </span>
          <span className="text-xs text-muted-foreground line-through flex-1 truncate">
            {oldLink.url}
          </span>
          <div className="w-7 shrink-0" />
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Label"
          value={link.label}
          disabled={disabled}
          onChange={
            onLabelChange ? (e) => onLabelChange(e.target.value) : undefined
          }
          className={cn(
            'h-7 text-sm flex-1',
            strikethrough && 'line-through',
            labelHighlight && 'bg-emerald-100'
          )}
        />
        <Input
          type="url"
          placeholder="https://example.com"
          value={link.url}
          disabled={disabled}
          onChange={
            onUrlChange ? (e) => onUrlChange(e.target.value) : undefined
          }
          className={cn(
            'h-7 text-sm flex-1',
            strikethrough && 'line-through',
            urlHighlight && 'bg-emerald-100'
          )}
        />
        {onDelete ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-red-600"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
          </Button>
        ) : (
          <div className="w-7 shrink-0" />
        )}
      </div>
    </div>
  )
}
