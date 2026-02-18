import { useEffect, useMemo, useState } from 'react'
import { useMainContext } from '@/context'
import { Button } from './ui/button'
import { Bell, CircleAlert, Plus } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

type Alert =
  | { type: 'diff'; id: string; name: string }
  | { type: 'circular'; cycle: string[] }
  | { type: 'duplicate'; name: string; ids: string[] }
  | { type: 'island'; id: string; name: string }

type AlertRendererProps = {
  alert: Alert
  onNavigate: (id: string) => void
  getNodeName: (id: string) => string
}

function AlertRenderer({ alert, onNavigate, getNodeName }: AlertRendererProps) {
  switch (alert.type) {
    case 'diff':
      return (
        <button
          onClick={() => onNavigate(alert.id)}
          className="flex items-center gap-3 p-3 hover:bg-muted text-left transition-colors border-b last:border-b-0"
        >
          <Plus className="size-4 text-blue-500 shrink-0" />
          <span className="font-medium text-sm truncate">{alert.name}</span>
        </button>
      )

    case 'circular':
      return (
        <div className="border-b last:border-b-0">
          <div className="flex items-center gap-3 p-3 text-red-600">
            <CircleAlert className="size-4 shrink-0" />
            <span className="font-medium text-sm">Circular dependency</span>
          </div>
          <div className="pl-10 pb-2 flex flex-wrap items-center gap-1">
            {alert.cycle.map((id) => (
              <span key={id} className="flex items-center gap-1">
                <button
                  onClick={() => onNavigate(id)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {getNodeName(id)}
                </button>
                <span className="text-xs text-muted-foreground">→</span>
              </span>
            ))}
            <button
              onClick={() => onNavigate(alert.cycle[0])}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {getNodeName(alert.cycle[0])}
            </button>
          </div>
        </div>
      )

    case 'duplicate':
      return (
        <div className="border-b last:border-b-0">
          <div className="flex items-center gap-3 p-3 text-red-600">
            <CircleAlert className="size-4 shrink-0" />
            <span className="font-medium text-sm">
              Duplicate name: "{alert.name}"
            </span>
          </div>
          <div className="pl-10 pb-2">
            {alert.ids.map((id) => (
              <button
                key={id}
                onClick={() => onNavigate(id)}
                className="block text-xs text-muted-foreground hover:text-foreground py-0.5"
              >
                {getNodeName(id)}
              </button>
            ))}
          </div>
        </div>
      )

    case 'island':
      return (
        <button
          onClick={() => onNavigate(alert.id)}
          className="flex items-center gap-3 p-3 hover:bg-muted text-left transition-colors border-b last:border-b-0"
        >
          <CircleAlert className="size-4 text-amber-500 shrink-0" />
          <div className="flex flex-col">
            <span className="font-medium text-sm truncate">{alert.name}</span>
            <span className="text-xs text-muted-foreground">
              Disconnected node
            </span>
          </div>
        </button>
      )
  }
}

function getAlertKey(alert: Alert, index: number): string {
  switch (alert.type) {
    case 'diff':
      return `diff-${alert.id}`
    case 'circular':
      return `circular-${index}`
    case 'duplicate':
      return `duplicate-${alert.name}`
    case 'island':
      return `island-${alert.id}`
  }
}

function getAlertNodeIds(alert: Alert): string[] {
  switch (alert.type) {
    case 'diff':
      return [alert.id]
    case 'circular':
      return alert.cycle
    case 'duplicate':
      return alert.ids
    case 'island':
      return [alert.id]
  }
}

export function AlertsPopover() {
  const { model, diffs, setOpenNode } = useMainContext()
  const [open, setOpen] = useState(false)
  const [currentAlertId, setCurrentAlertId] = useState<string | undefined>(
    undefined
  )
  const [autoAdvance, setAutoAdvance] = useState(false)

  const getNodeName = (id: string) => model.nodes[id]?.name ?? id

  // Build unified alerts array
  const alerts = useMemo(() => {
    const result: Alert[] = []

    // Diffs first
    for (const diff of diffs) {
      result.push({ type: 'diff', id: diff.id, name: diff.name })
    }

    // Circular dependencies
    const cycles: string[][] = []
    const visited = new Set<string>()
    const inStack = new Set<string>()
    const path: string[] = []

    const dfs = (nodeId: string) => {
      if (inStack.has(nodeId)) {
        const cycleStart = path.indexOf(nodeId)
        cycles.push(path.slice(cycleStart))
        return
      }
      if (visited.has(nodeId)) return

      visited.add(nodeId)
      inStack.add(nodeId)
      path.push(nodeId)

      const node = model.nodes[nodeId]
      if (node) {
        for (const depId of node.dependencies) {
          dfs(depId)
        }
      }

      path.pop()
      inStack.delete(nodeId)
    }

    for (const nodeId of Object.keys(model.nodes)) {
      if (!visited.has(nodeId)) {
        dfs(nodeId)
      }
    }

    for (const cycle of cycles) {
      result.push({ type: 'circular', cycle })
    }

    // Duplicate names
    const nameToIds: Record<string, string[]> = {}
    for (const node of Object.values(model.nodes)) {
      if (!nameToIds[node.name]) {
        nameToIds[node.name] = []
      }
      nameToIds[node.name].push(node.id)
    }
    for (const [name, ids] of Object.entries(nameToIds)) {
      if (ids.length > 1) {
        result.push({ type: 'duplicate', name, ids })
      }
    }

    // Island nodes
    const hasDependent = new Set<string>()
    for (const node of Object.values(model.nodes)) {
      for (const depId of node.dependencies) {
        hasDependent.add(depId)
      }
    }
    for (const node of Object.values(model.nodes)) {
      if (node.dependencies.length === 0 && !hasDependent.has(node.id)) {
        result.push({ type: 'island', id: node.id, name: node.name })
      }
    }

    return result
  }, [diffs, model.nodes])

  // Build list of all alert node IDs for auto-advance
  const allAlertIds = useMemo(() => {
    const ids: string[] = []
    for (const alert of alerts) {
      for (const id of getAlertNodeIds(alert)) {
        if (!ids.includes(id)) ids.push(id)
      }
    }
    return ids
  }, [alerts])

  // Auto-advance when current alert is resolved
  useEffect(() => {
    if (!autoAdvance) {
      return
    }

    if (allAlertIds.length > 0 && currentAlertId !== allAlertIds[0]) {
      setOpenNode(allAlertIds[0])
      setCurrentAlertId(allAlertIds[0])
    }
  }, [autoAdvance, allAlertIds, currentAlertId])

  const handleNavigate = (id: string) => {
    setOpenNode(id)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          title="Alerts"
          className="relative"
        >
          <Bell className="size-4" />
          {alerts.length > 0 && (
            <span className="absolute -top-1 -right-1 size-4 rounded-full bg-red-500 text-white text-xs flex items-center justify-center">
              {alerts.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="p-3 border-b flex items-center justify-between">
          <h4 className="font-semibold text-sm">Alerts</h4>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <span>Auto-advance</span>
            <button
              onClick={() => {
                const newValue = !autoAdvance
                setAutoAdvance(newValue)
                if (newValue && allAlertIds.length > 0) {
                  setOpenNode(allAlertIds[0])
                }
              }}
              className={`relative w-8 h-4 rounded-full transition-colors ${
                autoAdvance ? 'bg-blue-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                  autoAdvance ? 'translate-x-4' : ''
                }`}
              />
            </button>
          </label>
        </div>
        <div className="flex flex-col max-h-80 overflow-y-auto">
          {alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground p-3">
              No pending changes
            </p>
          ) : (
            alerts.map((alert, index) => (
              <AlertRenderer
                key={getAlertKey(alert, index)}
                alert={alert}
                onNavigate={handleNavigate}
                getNodeName={getNodeName}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
