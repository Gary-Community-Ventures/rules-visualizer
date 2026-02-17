import { useDeleteNode, useMainContext } from '@/context'
import { NodeViewer, Rows } from '@/components/node'
import { Arrows } from '@/components/arrows'
import { ToolBar } from '@/components/tool-bar'
import { PanContainer } from '@/components/pan-container'
import { getDependents, nodeRows } from '@/lib/graph'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { useState, type PropsWithChildren } from 'react'
import { Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function HomePage() {
  const { model, selectedNodes, showChildren } = useMainContext()

  const rows: string[][] = nodeRows(model.nodes, showChildren, selectedNodes)

  return (
    <div className="flex flex-col h-screen">
      <ToolBar />
      <NodeMapLayout>
        <PanContainer className="h-full">
          <Rows rows={rows} />
        </PanContainer>
        <Arrows rows={rows} />
      </NodeMapLayout>
    </div>
  )
}

export function NodeMapLayout({ children }: PropsWithChildren) {
  const { model, openNode, setOpenNode, setSelectedNodes } = useMainContext()
  const deleteNode = useDeleteNode()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const handleLayoutChange = () => {
    window.dispatchEvent(new CustomEvent('containerresize'))
  }

  const openNodeData = openNode ? model.nodes[openNode] : null
  const dependentIds = openNode ? getDependents(openNode, model.nodes) : []
  const dependentNames = dependentIds.map((id) => model.nodes[id]?.name ?? id)

  const handleDelete = () => {
    if (!openNode) return
    setSelectedNodes((prev) => prev.filter((id) => id !== openNode))
    setOpenNode(null)
    deleteNode(openNode)
    setShowDeleteDialog(false)
  }

  return (
    <ResizablePanelGroup onLayoutChange={handleLayoutChange}>
      {openNode !== null && openNodeData !== null && (
        <>
          <ResizablePanel defaultSize="50%" minSize="20%">
            <div className="flex flex-col h-full bg-background">
              <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
                <h2 className="text-sm font-semibold">Edit Node</h2>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => setShowDeleteDialog(true)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
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
              <div className="flex-1 overflow-y-auto p-5">
                <NodeViewer id={openNode} />
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />

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
                <Button
                  variant="outline"
                  onClick={() => setShowDeleteDialog(false)}
                >
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleDelete}>
                  Delete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
      <ResizablePanel defaultSize="50%" minSize="20%">
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
