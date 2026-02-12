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

export function HomePage() {
  const { model, selectedNodes, showChildren } = useMainContext()

  const rows: string[][] = nodeRows(model.nodes, showChildren, selectedNodes)

  return (
    <div className="flex flex-col h-screen">
      <ToolBar />
      <NodeMapLayout>
        <PanContainer className='h-full'>
          <Rows rows={rows} />
        </PanContainer>
        <Arrows rows={rows} />
      </NodeMapLayout>
    </div>
  )
}

export function NodeMapLayout({ children }: PropsWithChildren) {
  const { openNode } = useMainContext()

  if (openNode === null) {
    return <>{children}</>
  }

  const handleLayoutChange = () => {
    window.dispatchEvent(new CustomEvent('containerresize'))
  }

  return (
    <ResizablePanelGroup onLayoutChange={handleLayoutChange}>
      <ResizablePanel defaultSize="50%">
        <NodeViewer id={openNode} />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="50%">{children}</ResizablePanel>
    </ResizablePanelGroup>
  )
}
