import { useRef, useState, useEffect } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { useMainContext } from '@/context'
import { useNodeNavigation } from '@/lib/use-node-navigation'
import { useWorkspaceActions } from '@/lib/use-workspace-actions'
import { Button } from './ui/button'
import { cn } from '@/lib/utils'
import { LayoutList, X, GripVertical, Plus } from 'lucide-react'

export function WorkspaceDropdown() {
  const {
    model,
    openNode,
    workspaceItems,
    setWorkspaceItems,
    workspaces,
    activeWorkspaceId,
  } = useMainContext()
  const { createWorkspace, removeWorkspace, switchWorkspace } =
    useWorkspaceActions()
  const { setOpenNode } = useNodeNavigation()
  const [open, setOpen] = useState(false)

  const dragState = useRef<{ index: number; startY: number } | null>(null)
  const validItems = workspaceItems.filter((id) => model.nodes[id])

  useEffect(() => {
    const handleOpen = () => setOpen(true)
    const handleClose = () => setOpen(false)
    window.addEventListener('open-workspace', handleOpen)
    window.addEventListener('close-workspace', handleClose)
    return () => {
      window.removeEventListener('open-workspace', handleOpen)
      window.removeEventListener('close-workspace', handleClose)
    }
  }, [])

  const handleDragStart = (e: React.PointerEvent, index: number) => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragState.current = { index, startY: e.clientY }
  }

  const handleDragMove = (e: React.PointerEvent) => {
    if (!dragState.current) return
    const { index, startY } = dragState.current
    const delta = Math.round((e.clientY - startY) / 28)
    const target = Math.max(0, Math.min(index + delta, validItems.length - 1))
    if (target !== index) {
      setWorkspaceItems((prev) => {
        const next = [...prev]
        const [item] = next.splice(index, 1)
        next.splice(target, 0, item)
        return next
      })
      dragState.current = { index: target, startY: e.clientY }
    }
  }

  const handleDragEnd = () => {
    dragState.current = null
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="outline"
          size="icon"
          title="Workspace"
          className="relative"
        >
          <LayoutList className="size-4" />
          {validItems.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] font-medium rounded-full w-4 h-4 flex items-center justify-center">
              {validItems.length}
            </span>
          )}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-64 rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
          sideOffset={4}
          align="start"
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
        >
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs font-medium text-muted-foreground">
              Workspace
            </span>
            {validItems.length > 0 && (
              <button
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setWorkspaceItems([])}
              >
                Clear
              </button>
            )}
          </div>
          {/* Workspace switcher: one button per workspace + "+" creates a
              new empty workspace and makes it active. Each button doubles
              as a delete target via the hover X. */}
          <div className="flex flex-wrap items-center gap-1 mb-2 px-1">
            {workspaces.map((ws, i) => {
              const isActive = ws.id === activeWorkspaceId
              const label = `WS ${i + 1}`
              return (
                <div
                  key={ws.id}
                  className={cn(
                    'group flex items-center rounded-sm border text-[11px] font-mono leading-none transition-colors',
                    isActive
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  <button
                    className="px-1.5 py-0.5"
                    onClick={() => switchWorkspace(ws.id)}
                    title={`Switch to ${label}`}
                  >
                    {label}
                    <span className="ml-1 opacity-50">({ws.items.length})</span>
                  </button>
                  {workspaces.length > 1 && (
                    <button
                      className="opacity-0 group-hover:opacity-100 px-1 py-0.5 hover:text-destructive"
                      onClick={() => removeWorkspace(ws.id)}
                      title={`Delete ${label}`}
                    >
                      <X className="size-2.5" />
                    </button>
                  )}
                </div>
              )
            })}
            <button
              className="flex items-center rounded-sm border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/40"
              onClick={() => createWorkspace()}
              title="Create a new workspace"
            >
              <Plus className="size-2.5" />
            </button>
          </div>
          {validItems.length === 0 ? (
            <div className="text-xs text-muted-foreground px-1 py-3 text-center">
              Press{' '}
              <kbd className="px-1 py-0.5 rounded bg-muted font-mono">w</kbd> to
              add the current node
            </div>
          ) : (
            <div className="flex flex-col gap-0.5 max-h-72 overflow-y-auto">
              {validItems.map((id, i) => (
                <div
                  key={id}
                  className={cn(
                    'flex items-center gap-1 rounded-sm px-1 py-1 text-xs group transition-colors cursor-pointer',
                    openNode === id
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/50'
                  )}
                  onClick={() => setOpenNode(id)}
                >
                  <span
                    className="cursor-grab text-muted-foreground hover:text-foreground shrink-0"
                    onPointerDown={(e) => handleDragStart(e, i)}
                  >
                    <GripVertical className="size-3" />
                  </span>
                  <span className="w-4 text-center text-muted-foreground font-mono shrink-0">
                    {i < 9 ? i + 1 : ''}
                  </span>
                  <span className="font-mono truncate flex-1">
                    {model.nodes[id]?.name ?? id}
                  </span>
                  <button
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground shrink-0"
                    onClick={(e) => {
                      e.stopPropagation()
                      setWorkspaceItems((prev) => prev.filter((x) => x !== id))
                    }}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
