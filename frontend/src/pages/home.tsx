import { useFindNode, useMainContext } from '@/context'
import { useKeyboardShortcuts } from '@/lib/use-keyboard-shortcuts'
import { useAiChatStream } from '@/lib/use-ai-chat-stream'
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
import { useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { AIPanel } from '@/components/ai-panel'
import { Legend } from '@/components/legend'
import { ExecutionPanel } from '@/components/execution-panel'
import { TestPanel } from '@/components/test-panel'
import { PolicyPanel } from '@/components/policy-panel'
import { TasksPanel } from '@/components/tasks-panel'
import { ProfilesPanel } from '@/components/profiles-panel'
import { NodePanel, nodeElementId } from '@/components/node'
import { ShortcutsCheatsheet } from '@/components/shortcuts-cheatsheet'

export function HomePage({ active = true }: { active?: boolean }) {
  // Background tabs are kept mounted (display:none) to preserve state, so
  // the kbd hook + the modal listener must opt out when not active —
  // otherwise every hidden tab also processes the keystroke (silently
  // toggles its panels and stacks duplicate cheatsheet modals).
  useKeyboardShortcuts(active)
  // AI chat WS subscription lives at HomePage level (per-tab), not inside
  // AIPanel — keeps the listener installed even when the user closes the
  // sidebar mid-stream so chunks/tool events still flow into the
  // persisted chat history.
  useAiChatStream()
  const {
    model,
    selectedNodes,
    showChildren,
    isLoading,
    error,
    executionResults,
    activeTest,
  } = useMainContext()

  // Set browser tab title only when this tab is active
  useEffect(() => {
    if (active && model.name) {
      document.title = `${model.name} — Rules Visualizer`
    }
  }, [active, model.name])

  // The keyboard hook fires `open-shortcuts` on `?` and HomePage owns
  // the modal state so the hook stays state-free.
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  useEffect(() => {
    if (!active) return
    const onOpen = () => setShortcutsOpen(true)
    window.addEventListener('open-shortcuts', onOpen)
    return () => window.removeEventListener('open-shortcuts', onOpen)
  }, [active])

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
      {/* Only the active tab renders the modal. Background tabs are kept
          mounted (display:none on the layout div), but Dialog portals to
          body so display:none can't hide a stale-open cheatsheet from a
          previous activation — gating render here avoids the duplicate. */}
      {active && (
        <ShortcutsCheatsheet
          open={shortcutsOpen}
          onOpenChange={setShortcutsOpen}
        />
      )}
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
    <ResizablePanelGroup
      autoSave={`layout:outer:${rulesetId}`}
      onLayoutChange={handleLayoutChange}
    >
      <ResizablePanel id="main" defaultSize={rightBar ? 75 : 100} minSize="40%">
        <ResizablePanelGroup
          autoSave={`layout:inner:${rulesetId}`}
          onLayoutChange={handleLayoutChange}
        >
          {showNodePanel && (
            <>
              <ResizablePanel
                id="node"
                defaultSize={50}
                minSize="20%"
                className="relative z-[5]"
              >
                <NodePanel />
              </ResizablePanel>
              <ResizableHandle withHandle />
            </>
          )}
          <ResizablePanel id="canvas" defaultSize={50} minSize="20%">
            {children}
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
      {rightBar !== null && (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel
            id="rightbar"
            defaultSize={25}
            minSize="20%"
            className="overflow-hidden relative z-[5]"
          >
            {rightBar === 'ai' && <AIPanel />}
            {rightBar === 'execution' && <ExecutionPanel />}
            {rightBar === 'tests' && <TestPanel />}
            {rightBar === 'policy' && <PolicyPanel />}
            {rightBar === 'tasks' && <TasksPanel />}
            {rightBar === 'profiles' && <ProfilesPanel />}
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  )
}
