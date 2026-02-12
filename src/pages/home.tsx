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
            <div className="relative h-full p-5 bg-background">
              <Button
                variant="outline"
                size="icon"
                className="absolute top-3 right-3 origin-top-right"
                onClick={() => setOpenNode(null)}
              >
                <X />
              </Button>
              <div className="mt-5">
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
