import { useFindNode, useMainContext } from '@/context'
import { useKeyboardShortcuts } from '@/lib/use-keyboard-shortcuts'
import { Rows } from '@/components/node'
import { Arrows } from '@/components/arrows'
import { ToolBar } from '@/components/tool-bar'
import { PanContainer } from '@/components/pan-container'
import { nodeRows } from '@/lib/graph'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { useEffect, useMemo, type PropsWithChildren } from 'react'
import { AIPanel } from '@/components/ai-panel'
import { Legend } from '@/components/legend'
import { ExecutionPanel } from '@/components/execution-panel'
import { TestPanel } from '@/components/test-panel'
import { PolicyPanel } from '@/components/policy-panel'
import { NodePanel, nodeElementId } from '@/components/node'

export function HomePage() {
  useKeyboardShortcuts()
  const {
    model,
    selectedNodes,
    showChildren,
    isLoading,
    error,
    executionResults,
    activeTest,
  } = useMainContext()

  const rows = useMemo(
    () => nodeRows(model.nodes, showChildren, selectedNodes),
    [model.nodes, showChildren, selectedNodes]
  )

  // Nodes change size when execution/test results appear (result badges
  // expand the cards). Arrows are positioned from getBoundingClientRect, so
  // they need to recompute after the layout settles.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      window.dispatchEvent(new Event('containerresize'))
    })
    return () => cancelAnimationFrame(id)
  }, [executionResults, activeTest])

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
        <Legend />
      </NodeMapLayout>
    </>
  )
}

export function NodeMapLayout({ children }: PropsWithChildren) {
  const { openNode, rightBar, rulesetId } = useMainContext()
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
      const el = document.getElementById(nodeElementId(rulesetId, openNode))
      el?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      })
    }, 150)
    return () => clearTimeout(timer)
  }, [openNode, rulesetId])

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
            {rightBar === 'tests' && <TestPanel />}
            {rightBar === 'policy' && <PolicyPanel />}
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  )
}
