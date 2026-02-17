import { useEffect, useMemo, useRef, useState } from 'react'
import { useAddNode, useMainContext } from '@/context'
import { Button } from './ui/button'
import {
  Download,
  Upload,
  Menu,
  CircleAlert,
  X,
  Maximize2,
  Minimize2,
  Plus,
  CircleDot,
  Hash,
  Braces,
  Table as TableIcon,
  Bell,
} from 'lucide-react'
import {
  createNode,
  createInput,
  createConstant,
  createContext,
  createDecisionTable,
} from '@/lib/model'
import {
  downloadFile,
  readFileAsText,
  exportModelToJson,
  importModelFromJson,
  exportModelToDmnXml,
} from '@/lib/export'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import {
  Combobox,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor,
} from './ui/combobox'
import { InputModal } from './input-modal'
import { SettingsModal } from './settings-modal'
import { Link } from '@tanstack/react-router'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

function ExecutionError() {
  const { lastError, setLastError } = useMainContext()

  if (!lastError) return null

  return (
    <div className="flex items-center gap-1.5 rounded-md bg-red-50 border border-red-200 text-red-700 px-2.5 py-1 text-xs max-w-md">
      <CircleAlert className="size-3.5 shrink-0" />
      <span className="truncate" title={lastError}>
        {lastError}
      </span>
      <button
        onClick={() => setLastError(null)}
        className="shrink-0 hover:text-red-900"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

function LastRunDisplay() {
  const { lastRunTimestamp, resultStale } = useMainContext()
  const [, setTick] = useState(0)

  useEffect(() => {
    if (lastRunTimestamp === null) return
    const interval = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(interval)
  }, [lastRunTimestamp])

  if (lastRunTimestamp === null) return null

  const seconds = Math.floor((Date.now() - lastRunTimestamp) / 1000)
  let display: string
  if (seconds < 10) {
    display = 'just now'
  } else if (seconds < 60) {
    display = '<1m ago'
  } else if (seconds < 3600) {
    display = `${Math.floor(seconds / 60)}m ago`
  } else {
    display = `${Math.floor(seconds / 3600)}h ago`
  }

  return (
    <span
      className={`text-xs ${resultStale ? 'text-amber-600' : 'text-muted-foreground'}`}
    >
      Last run: {display}
    </span>
  )
}

function AlertsPopover() {
  const { model, diffs, setOpenNode } = useMainContext()
  const [open, setOpen] = useState(false)

  const handleClick = (id: string) => {
    setOpenNode(id)
  }

  // Compute duplicate names
  const duplicateNames = useMemo(() => {
    const nameToIds: Record<string, string[]> = {}
    for (const node of Object.values(model.nodes)) {
      if (!nameToIds[node.name]) {
        nameToIds[node.name] = []
      }
      nameToIds[node.name].push(node.id)
    }
    return Object.entries(nameToIds)
      .filter(([, ids]) => ids.length > 1)
      .map(([name, ids]) => ({ name, ids }))
  }, [model.nodes])

  // Detect circular dependencies
  const circularDependencies = useMemo(() => {
    const cycles: string[][] = []
    const visited = new Set<string>()
    const inStack = new Set<string>()
    const path: string[] = []

    const dfs = (nodeId: string) => {
      if (inStack.has(nodeId)) {
        // Found a cycle - extract it from path
        const cycleStart = path.indexOf(nodeId)
        const cycle = path.slice(cycleStart)
        cycles.push(cycle)
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

    return cycles
  }, [model.nodes])

  const totalAlerts = diffs.length + duplicateNames.length + circularDependencies.length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" title="Alerts" className="relative">
          <Bell className="size-4" />
          {totalAlerts > 0 && (
            <span className="absolute -top-1 -right-1 size-4 rounded-full bg-red-500 text-white text-xs flex items-center justify-center">
              {totalAlerts}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="p-3 border-b">
          <h4 className="font-semibold text-sm">Alerts</h4>
        </div>
        <div className="flex flex-col max-h-80 overflow-y-auto">
          {totalAlerts === 0 ? (
            <p className="text-sm text-muted-foreground p-3">No pending changes</p>
          ) : (
            <>
              {/* Circular dependency errors */}
              {circularDependencies.map((cycle, i) => (
                <div key={`cycle-${i}`} className="border-b last:border-b-0">
                  <div className="flex items-center gap-3 p-3 text-red-600">
                    <CircleAlert className="size-4 shrink-0" />
                    <span className="font-medium text-sm">Circular dependency</span>
                  </div>
                  <div className="pl-10 pb-2 flex flex-wrap items-center gap-1">
                    {cycle.map((id, j) => (
                      <span key={id} className="flex items-center gap-1">
                        <button
                          onClick={() => handleClick(id)}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          {model.nodes[id]?.name ?? id}
                        </button>
                        <span className="text-xs text-muted-foreground">→</span>
                      </span>
                    ))}
                    <button
                      onClick={() => handleClick(cycle[0])}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      {model.nodes[cycle[0]]?.name ?? cycle[0]}
                    </button>
                  </div>
                </div>
              ))}
              {/* Duplicate name errors */}
              {duplicateNames.map(({ name, ids }) => (
                <div key={`dup-${name}`} className="border-b last:border-b-0">
                  <div className="flex items-center gap-3 p-3 text-red-600">
                    <CircleAlert className="size-4 shrink-0" />
                    <span className="font-medium text-sm">
                      Duplicate name: "{name}"
                    </span>
                  </div>
                  <div className="pl-10 pb-2">
                    {ids.map((id) => (
                      <button
                        key={id}
                        onClick={() => handleClick(id)}
                        className="block text-xs text-muted-foreground hover:text-foreground py-0.5"
                      >
                        {model.nodes[id]?.name ?? id}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {/* Pending diffs */}
              {diffs.map((diff) => (
                <button
                  key={diff.id}
                  onClick={() => handleClick(diff.id)}
                  className="flex items-center gap-3 p-3 hover:bg-muted text-left transition-colors border-b last:border-b-0"
                >
                  <Plus className="size-4 text-blue-500 shrink-0" />
                  <span className="font-medium text-sm truncate">{diff.name}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ToolBar() {
  const {
    model,
    setModel,
    selectedNodes,
    setSelectedNodes,
    setShowChildren,
    setOpenNode,
    execution,
  } = useMainContext()
  const addNode = useAddNode()
  const [search, setSearch] = useState('')
  const anchorRef = useComboboxAnchor()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const nodeIds = Object.keys(model.nodes)
  const filteredNodeIds = nodeIds.filter(
    (id) =>
      model.nodes[id].name.toLowerCase().includes(search.toLowerCase()) &&
      !selectedNodes.includes(id)
  )

  const addTypedNode = (
    type: 'input' | 'constant' | 'context' | 'decisionTable'
  ) => {
    const contentMap = {
      input: createInput(),
      constant: createConstant(),
      context: createContext(),
      decisionTable: createDecisionTable(),
    }
    const node = createNode({ content: contentMap[type] })
    addNode(node.id, node)
    setOpenNode(node.id)
  }

  return (
    <div className="border-b flex items-center gap-5 p-2 bg-background relative z-10">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>
            <Plus className="size-4" />
            Add Node
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={6}>
          <DropdownMenuItem onSelect={() => addTypedNode('input')}>
            <CircleDot className="size-4" />
            Input
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => addTypedNode('constant')}>
            <Hash className="size-4" />
            Constant
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => addTypedNode('context')}>
            <Braces className="size-4" />
            Decision
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => addTypedNode('decisionTable')}>
            <TableIcon className="size-4" />
            Decision Table
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Combobox multiple value={selectedNodes} onValueChange={setSelectedNodes}>
        <ComboboxChips ref={anchorRef}>
          {selectedNodes.map((nodeId) => (
            <ComboboxChip key={nodeId} value={nodeId}>
              {model.nodes[nodeId]?.name ?? nodeId}
            </ComboboxChip>
          ))}
          <ComboboxChipsInput
            placeholder={selectedNodes.length === 0 ? 'Search...' : ''}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </ComboboxChips>
        <ComboboxContent anchor={anchorRef}>
          <ComboboxList>
            {filteredNodeIds.map((nodeId) => (
              <ComboboxItem key={nodeId} value={nodeId}>
                {model.nodes[nodeId].name}
              </ComboboxItem>
            ))}
          </ComboboxList>
          {filteredNodeIds.length === 0 && (
            <ComboboxEmpty>No nodes found.</ComboboxEmpty>
          )}
        </ComboboxContent>
      </Combobox>

      <div className="flex gap-1">
        <Button
          variant="outline"
          size="icon"
          title="Expand all"
          onClick={() => {
            const all: Record<string, boolean> = {}
            for (const id of Object.keys(model.nodes)) {
              all[id] = true
            }
            setShowChildren(all)
          }}
        >
          <Maximize2 className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          title="Collapse all"
          onClick={() => setShowChildren({})}
        >
          <Minimize2 className="size-4" />
        </Button>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <ExecutionError />
        <LastRunDisplay />
        <Button variant="outline" size="icon" title="Constants" asChild>
          <Link to="/constants">
            <Hash className="size-4" />
          </Link>
        </Button>
        <AlertsPopover />
        <InputModal />
        <SettingsModal />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label="Export and import menu"
            >
              <Menu className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Export / Import</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                const name = model.name || 'untitled'
                const xml = exportModelToDmnXml(model)
                downloadFile(`${name}.dmn`, xml, 'application/xml')
              }}
            >
              <Download className="size-4" />
              Export DMN
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                const name = model.name || 'untitled'
                const json = exportModelToJson(model)
                downloadFile(`${name}.json`, json, 'application/json')
              }}
            >
              <Download className="size-4" />
              Export JSON
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                setTimeout(() => fileInputRef.current?.click(), 0)
              }}
            >
              <Upload className="size-4" />
              Import JSON
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (!file) return
            try {
              const text = await readFileAsText(file)
              const imported = importModelFromJson(text)
              setSelectedNodes([])
              setShowChildren({})
              execution.reset()
              setModel(imported)
            } catch (err) {
              console.error('Failed to import JSON:', err)
              alert(
                `Failed to import JSON: ${err instanceof Error ? err.message : 'Unknown error'}`
              )
            }
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
