import { useMainContext } from '@/context'
import { NodeViewer, Rows } from '@/components/node'
import { Arrows } from '@/components/arrows'
import { ToolBar } from '@/components/tool-bar'
import { PanContainer } from '@/components/pan-container'
import { nodeRows } from '@/lib/graph'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import type { PropsWithChildren } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
  const { openNode, setOpenNode } = useMainContext()

  const handleLayoutChange = () => {
    window.dispatchEvent(new CustomEvent('containerresize'))
  }

  return (
    <ResizablePanelGroup onLayoutChange={handleLayoutChange}>
      {openNode !== null && (
        <>
          <ResizablePanel defaultSize="50%" minSize="20%">
            <div className="flex flex-col h-full bg-background">
              <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
                <h2 className="text-sm font-semibold">Edit Node</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setOpenNode(null)}
                >
                  <X className="size-4" />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                <NodeViewer id={openNode} />
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
        </>
      )}
      <ResizablePanel defaultSize="50%" minSize="20%">
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
