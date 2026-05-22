import { useState, useCallback } from 'react'
import type { NodeContent } from '@/lib/model'
import { useMainContext } from '@/context'
import { useNodeNavigation } from '@/lib/use-node-navigation'
import {
  findFactGraphNodeIdByPath,
  resolveFactGraphPath,
} from '@/lib/factgraph-paths'
import { LogicHighlighter } from './logic-highlighter'

type Props = {
  content: Extract<NodeContent, { format: 'factGraph'; type: 'derived' }>
}

export function FactGraphDerivedViewer({ content }: Props) {
  const { model } = useMainContext()
  const { setOpenNode } = useNodeNavigation()

  const navigateToPath = useCallback(
    (rawPath: string) => {
      const path = resolveFactGraphPath(rawPath, content.path)
      const nodeId = findFactGraphNodeIdByPath(model.nodes, path)
      if (nodeId) setOpenNode(nodeId)
    },
    [model.nodes, setOpenNode, content.path]
  )

  return (
    <div className="flex flex-col gap-3 text-sm">
      {content.logic && (
        <div>
          <span className="text-muted-foreground font-medium">Logic</span>
          <LogicHighlighter
            format="factGraph"
            logic={content.logic}
            onNavigate={navigateToPath}
          />
        </div>
      )}
      <AdvancedSection>
        {content.dataType && <Field label="Returns" value={content.dataType} />}
        <Field label="Path" value={content.path} />
        {content.placeholderLogic !== undefined && (
          <div>
            <span className="text-muted-foreground font-medium">
              Placeholder
            </span>
            {content.placeholderLogic ? (
              <LogicHighlighter
                format="factGraph"
                logic={content.placeholderLogic}
                onNavigate={navigateToPath}
              />
            ) : (
              <p className="mt-0.5 text-muted-foreground italic">(empty)</p>
            )}
          </div>
        )}
      </AdvancedSection>
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
