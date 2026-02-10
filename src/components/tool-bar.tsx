import { useState } from 'react'
import { useAddNode, useMainContext } from '@/context'
import { Button } from './ui/button'
import { createDefaultNode } from '@/lib/nodes'
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
  const { nodes, selectedNodes, setSelectedNodes } = useMainContext()
  const addNode = useAddNode()
  const [search, setSearch] = useState('')
  const anchorRef = useComboboxAnchor()

  const nodeIds = Object.keys(nodes)
  const filteredNodeIds = nodeIds.filter(
    (id) =>
      id.toLowerCase().includes(search.toLowerCase()) &&
      !selectedNodes.includes(id)
  )

  // FIXME: For testing only
  const newNode = () => {
    const base = createDefaultNode('context')

    const numDeps = Math.min(Math.floor(Math.random() * 3) + 1, nodeIds.length)

    const shuffled = [...nodeIds].sort(() => Math.random() - 0.5)
    base.dependencies = shuffled.slice(0, numDeps)

    return base
  }
  // FIXME: End for testing only

  return (
    <div className="border-b flex gap-5 p-2 bg-background relative z-10">
      <Button onClick={() => addNode(Math.random().toString(), newNode())}>
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
    </div>
  )
}
