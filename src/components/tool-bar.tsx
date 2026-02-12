import { useRef, useState } from 'react'
import { useAddNode, useMainContext } from '@/context'
import { Button } from './ui/button'
import { Download, Upload, Menu } from 'lucide-react'
import { createNode, generateId } from '@/lib/model'
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

export function ToolBar() {
  const { model, setModel, selectedNodes, setSelectedNodes, setShowChildren } =
    useMainContext()
  const addNode = useAddNode()
  const [search, setSearch] = useState('')
  const anchorRef = useComboboxAnchor()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const nodeIds = Object.keys(model.nodes)
  const filteredNodeIds = nodeIds.filter(
    (id) =>
      id.toLowerCase().includes(search.toLowerCase()) &&
      !selectedNodes.includes(id)
  )

  // FIXME: For testing only
  const newNode = () => {
    const id = generateId('node')
    const base = createNode(id, id)

    const numDeps = Math.min(Math.floor(Math.random() * 3) + 1, nodeIds.length)

    const shuffled = [...nodeIds].sort(() => Math.random() - 0.5)
    base.dependencies = shuffled.slice(0, numDeps)

    return { id, node: base }
  }
  // FIXME: End for testing only

  return (
    <div className="border-b flex items-center gap-5 p-2 bg-background relative z-10">
      <Button
        onClick={() => {
          const { id, node } = newNode()
          addNode(id, node)
        }}
      >
        Add Node
      </Button>

      <Combobox multiple value={selectedNodes} onValueChange={setSelectedNodes}>
        <ComboboxChips ref={anchorRef}>
          {selectedNodes.map((nodeId) => (
            <ComboboxChip key={nodeId} value={nodeId}>
              {nodeId.slice(0, 8)}...
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
                {nodeId}
              </ComboboxItem>
            ))}
          </ComboboxList>
          {filteredNodeIds.length === 0 && (
            <ComboboxEmpty>No nodes found.</ComboboxEmpty>
          )}
        </ComboboxContent>
      </Combobox>

      <div className="ml-auto">
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
              onSelect={(e) => {
                e.preventDefault()
                fileInputRef.current?.click()
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
