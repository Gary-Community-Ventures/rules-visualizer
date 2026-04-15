import { useState, useCallback } from 'react'
import type { NodeContent } from '@/lib/model'
import { useMainContext } from '@/context'
import { getNodePath } from '@/context/model-context'
import { parseFromBlocks, getBlockForYear } from '@/lib/logic'
import { LogicHighlighter } from './logic-highlighter'

type Props = {
  content: Extract<NodeContent, { format: 'rac'; type: 'variable' }>
}

export function RacVariableViewer({ content }: Props) {
  const { logicYear, model, setOpenNode } = useMainContext()

  const navigateToPath = useCallback(
    (varName: string) => {
      // RAC variables are referenced by name, which is also the node ID
      if (model.nodes[varName]) {
        setOpenNode(varName)
        return
      }
      // Fallback: search by path
      for (const [nodeId, node] of Object.entries(model.nodes)) {
        if (getNodePath(node.content) === varName) {
          setOpenNode(nodeId)
          return
        }
      }
    },
    [model.nodes, setOpenNode]
  )

  let logicDisplay: React.ReactNode = null
  if (content.logic) {
    const blocks = parseFromBlocks(content.logic)
    if (blocks.length > 0) {
      const active = getBlockForYear(blocks, logicYear)
      if (active) {
        logicDisplay = (
          <div>
            <span className="text-muted-foreground font-medium">
              Logic{' '}
              <span className="text-xs font-normal">(from {active.date})</span>
            </span>
            <LogicHighlighter
              format="rac"
              logic={active.body}
              onNavigate={navigateToPath}
            />
          </div>
        )
      }
    } else {
      logicDisplay = (
        <div>
          <span className="text-muted-foreground font-medium">Logic</span>
          <LogicHighlighter
            format="rac"
            logic={content.logic}
            onNavigate={navigateToPath}
          />
        </div>
      )
    }
  } else if (content.default) {
    logicDisplay = (
      <div>
        <span className="text-muted-foreground font-medium">Logic</span>
        <LogicHighlighter
          format="rac"
          logic={content.default}
          onNavigate={navigateToPath}
        />
      </div>
    )
  }

  const hasAdvanced = !!(content.entity || content.unit)

  return (
    <div className="flex flex-col gap-3 text-sm">
      {logicDisplay}
      {hasAdvanced && (
        <AdvancedSection>
          {content.entity && <Field label="Entity" value={content.entity} />}
          {content.unit && <Field label="Unit" value={content.unit} />}
        </AdvancedSection>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground font-medium">{label}</span>
      <p className="mt-0.5">{value}</p>
    </div>
  )
}

function AdvancedSection({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t pt-2">
      <button
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen(!open)}
      >
        {open ? '▾ Advanced' : '▸ Advanced'}
      </button>
      {open && <div className="mt-2 flex flex-col gap-3">{children}</div>}
    </div>
  )
}
