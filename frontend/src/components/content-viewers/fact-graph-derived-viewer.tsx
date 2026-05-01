import { useState, useCallback } from 'react'
import type { NodeContent } from '@/lib/model'
import { useMainContext } from '@/context'
import { getNodePath } from '@/context/model-context'
import { useNodeNavigation } from '@/lib/use-node-navigation'
import { LogicHighlighter } from './logic-highlighter'

type Props = {
  content: Extract<NodeContent, { format: 'factGraph'; type: 'derived' }>
}

export function FactGraphDerivedViewer({ content }: Props) {
  const { model } = useMainContext()
  const { setOpenNode } = useNodeNavigation()

  const navigateToPath = useCallback(
    (rawPath: string) => {
      // Resolve relative paths (e.g. ../meetsAbawdWorkRequirements)
      // against the current node's path. In fact graph, ../ means
      // "sibling in the same collection" — pop the field name, strip
      // ../ prefixes, append the remainder.
      let path = rawPath
      if (path.startsWith('..') && content.path) {
        const segments = content.path.split('/').filter(Boolean)
        segments.pop() // remove current node's field name
        let remaining = rawPath
        while (remaining.startsWith('../')) {
          remaining = remaining.slice(3)
        }
        path = '/' + segments.join('/') + '/' + remaining
      }

      for (const [nodeId, node] of Object.entries(model.nodes)) {
        if (getNodePath(node.content) === path) {
          setOpenNode(nodeId)
          return
        }
      }
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
