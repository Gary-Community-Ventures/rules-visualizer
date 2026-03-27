import { useState } from 'react'
import type { NodeContent } from '@/lib/model'
import { useMainContext } from '@/context'
import { parseFromBlocks, getBlockForYear } from '@/lib/logic'

type Props = {
  content: Extract<NodeContent, { format: 'rac'; type: 'variable' }>
}

export function RacVariableViewer({ content }: Props) {
  const { logicYear } = useMainContext()

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
              <span className="text-xs font-normal">
                (from {active.date})
              </span>
            </span>
            <pre className="mt-1 rounded-md border bg-muted/50 p-2 text-xs whitespace-pre-wrap font-mono">
              {active.body}
            </pre>
          </div>
        )
      }
    } else {
      logicDisplay = (
        <div>
          <span className="text-muted-foreground font-medium">Logic</span>
          <pre className="mt-1 rounded-md border bg-muted/50 p-2 text-xs whitespace-pre-wrap font-mono">
            {content.logic}
          </pre>
        </div>
      )
    }
  } else if (content.default) {
    logicDisplay = (
      <div>
        <span className="text-muted-foreground font-medium">Logic</span>
        <pre className="mt-1 rounded-md border bg-muted/50 p-2 text-xs whitespace-pre-wrap font-mono">
          {content.default}
        </pre>
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
