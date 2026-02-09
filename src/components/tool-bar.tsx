import { useAddNode, useMainContext } from '@/context'
import { Button } from './ui/button'
import { createDefaultNode } from '@/lib/nodes'
import { useEffect } from 'react'

export function ToolBar() {
  const { nodes } = useMainContext()
  const addNode = useAddNode()

  // FIXME: For testing only
  const newNode = () => {
    const base = createDefaultNode('context')

    base.dependencies = [
      Object.keys(nodes)[Math.floor(Math.random() * Object.keys(nodes).length)],
    ]
    return base
  }
  // FIXME: End for testing only

  return (
    <div className="border-b">
      <Button onClick={() => addNode(Math.random().toString(), newNode())}>
        Add Node
      </Button>
    </div>
  )
}
