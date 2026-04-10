import { useFindNode, useMainContext } from '@/context'
import { useKeyboardShortcuts } from '@/lib/use-keyboard-shortcuts'
import { Rows } from '@/components/node'
import { Arrows } from '@/components/arrows'
import { ToolBar } from '@/components/tool-bar'
import { PanContainer } from '@/components/pan-container'
import { nodeRows, filterDisconnectedCollectionNodes } from '@/lib/graph'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { useEffect, useMemo, type PropsWithChildren } from 'react'
import { AIPanel } from '@/components/ai-panel'
import { ExecutionPanel } from '@/components/execution-panel'
import { NodePanel, nodeElementId } from '@/components/node'

export function HomePage() {
  useKeyboardShortcuts()
  const { model, selectedNodes, showChildren, isLoading, error } =
    useMainContext()

  const rows = useMemo(() => {
    const visibleNodes = filterDisconnectedCollectionNodes(model.nodes)
    return nodeRows(visibleNodes, showChildren, selectedNodes)
  }, [model.nodes, showChildren, selectedNodes])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">Loading ruleset...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    )
  }

  return (
    <>
      <ToolBar />
      <NodeMapLayout>
        <PanContainer className="h-full">
          <Rows rows={rows} />
        </PanContainer>
        <Arrows rows={rows} />
      </NodeMapLayout>
    </>
  )
}

export function NodeMapLayout({ children }: PropsWithChildren) {
  const { openNode, rightBar } = useMainContext()
  const openNodeData = useFindNode(openNode)

  const handleLayoutChange = () => {
    window.dispatchEvent(new CustomEvent('containerresize'))
  }

  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('containerresize'))
    })
    return () => cancelAnimationFrame(frameId)
  }, [openNode, rightBar])

  // Scroll the open node into view
  useEffect(() => {
    if (!openNode) return
    // Delay to let layout settle after panel opens
    const timer = setTimeout(() => {
      const el = document.getElementById(nodeElementId(openNode))
      el?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      })
    }, 150)
    return () => clearTimeout(timer)
  }, [openNode])

  const showNodePanel = openNode !== null && openNodeData !== undefined

  return (
    <ResizablePanelGroup onLayoutChange={handleLayoutChange}>
      <ResizablePanel defaultSize={rightBar ? 75 : 100} minSize="40%">
        <ResizablePanelGroup onLayoutChange={handleLayoutChange}>
          {showNodePanel && (
            <>
              <ResizablePanel
                defaultSize={50}
                minSize="20%"
                className="relative z-[5]"
              >
                <NodePanel />
              </ResizablePanel>
              <ResizableHandle withHandle />
            </>
          )}
          <ResizablePanel defaultSize={50} minSize="20%">
            {children}
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
      {rightBar !== null && (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel
            defaultSize={25}
            minSize="20%"
            className="overflow-hidden relative z-[5]"
          >
            {rightBar === 'ai' && <AIPanel />}
            {rightBar === 'execution' && <ExecutionPanel />}
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  )
}
