import { useState, useEffect } from 'react'
import { useMainContext } from '@/context'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { cn } from '@/lib/utils'
import {
  Maximize2,
  Minimize2,
  Play,
  Sparkles,
  Loader2,
  FlaskConical,
  Calendar,
  ChevronLeft,
  ChevronRight,
  History,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
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

function YearPicker() {
  const { model, logicYear, setLogicYear } = useMainContext()

  if (model.format !== 'rac') return null

  return (
    <div className="flex items-center gap-1.5">
      <Calendar className="size-3.5 text-muted-foreground" />
      <Input
        type="number"
        min={1900}
        max={2100}
        value={logicYear}
        onChange={(e) => {
          const val = parseInt(e.target.value, 10)
          if (!isNaN(val)) setLogicYear(val)
        }}
        className="h-7 w-20 text-xs font-mono"
        title="Year for logic display"
      />
    </div>
  )
}

function NodeNavigation() {
  const {
    model,
    openNode,
    nodeHistory,
    nodeHistoryIndex,
    goBackNode,
    goForwardNode,
    goToHistoryIndex,
  } = useMainContext()
  const [historyOpen, setHistoryOpen] = useState(false)

  useEffect(() => {
    const handler = () => setHistoryOpen(true)
    window.addEventListener('open-history', handler)
    return () => window.removeEventListener('open-history', handler)
  }, [])

  if (nodeHistory.length === 0) return null

  const canGoBack = openNode === null || nodeHistoryIndex > 0
  const canGoForward = nodeHistoryIndex < nodeHistory.length - 1

  return (
    <div className="flex gap-1">
      <Button
        variant="outline"
        size="icon"
        disabled={!canGoBack}
        onClick={goBackNode}
        title="Go back"
      >
        <ChevronLeft className="size-4" />
      </Button>
      <DropdownMenu.Root open={historyOpen} onOpenChange={setHistoryOpen}>
        <DropdownMenu.Trigger asChild>
          <Button
            variant="outline"
            size="icon"
            disabled={nodeHistory.length === 0}
            title="History"
          >
            <History className="size-4" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="z-50 min-w-40 max-h-60 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            sideOffset={4}
            align="start"
          >
            {[...nodeHistory].reverse().map((id, ri) => {
              const i = nodeHistory.length - 1 - ri
              return (
                <DropdownMenu.Item
                  key={`${id}-${i}`}
                  className={cn(
                    'relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground',
                    i === nodeHistoryIndex && 'font-semibold bg-accent/50'
                  )}
                  onSelect={(e) => {
                    e.preventDefault()
                    goToHistoryIndex(i)
                  }}
                >
                  {model.nodes[id]?.name ?? id}
                </DropdownMenu.Item>
              )
            })}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Button
        variant="outline"
        size="icon"
        disabled={!canGoForward}
        onClick={goForwardNode}
        title="Go forward"
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  )
}

export function ToolBar() {
  const {
    model,
    selectedNodes,
    setSelectedNodes,
    setShowChildren,
    rightBar,
    setRightBar,
    isExecuting,
    executionError,
    runExecution,
  } = useMainContext()
  const [search, setSearch] = useState('')
  const anchorRef = useComboboxAnchor()

  const nodeIds = Object.keys(model.nodes)
  const filteredNodeIds = nodeIds.filter(
    (id) =>
      model.nodes[id].name.toLowerCase().includes(search.toLowerCase()) &&
      !selectedNodes.includes(id)
  )

  return (
    <div className="border-b flex items-center gap-5 p-2 bg-background relative z-10">
      <NodeNavigation />
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
          onClick={() => setShowChildren({})}
        >
          <Maximize2 className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          title="Collapse all"
          onClick={() => {
            const all: Record<string, boolean> = {}
            for (const id of Object.keys(model.nodes)) {
              all[id] = false
            }
            setShowChildren(all)
          }}
        >
          <Minimize2 className="size-4" />
        </Button>
      </div>

      <YearPicker />

      <div className="ml-auto flex items-center gap-2">
        {executionError && (
          <span
            className="text-xs text-red-600 max-w-48 truncate"
            title={executionError}
          >
            {executionError}
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          title="Run with current inputs"
          onClick={runExecution}
          disabled={isExecuting}
          className="gap-1.5"
        >
          {isExecuting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
          Run
        </Button>
        <Button
          variant={rightBar === 'execution' ? 'default' : 'outline'}
          size="icon"
          title="Execution panel"
          onClick={() =>
            setRightBar(rightBar === 'execution' ? null : 'execution')
          }
        >
          <FlaskConical className="size-4" />
        </Button>
        <Button
          variant={rightBar === 'ai' ? 'default' : 'outline'}
          size="icon"
          title="AI Assistant"
          onClick={() => setRightBar(rightBar === 'ai' ? null : 'ai')}
        >
          <Sparkles className="size-4" />
        </Button>
      </div>
    </div>
  )
}
