import { useState } from 'react'
import type { NodeContent } from '@/lib/model'

type Props = {
  content: Extract<NodeContent, { format: 'factGraph'; type: 'derived' }>
}

export function FactGraphDerivedViewer({ content }: Props) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      {content.logic ? (
        <div>
          <span className="text-muted-foreground font-medium">Logic</span>
          <pre className="mt-1 rounded-md border bg-muted/50 p-2 text-xs whitespace-pre-wrap font-mono">
            {content.logic}
          </pre>
        </div>
      ) : content.computation ? (
        <div>
          <span className="text-muted-foreground font-medium">Computation</span>
          <pre className="mt-1 rounded-md border bg-muted/50 p-2 text-xs whitespace-pre-wrap">
            {content.computation}
          </pre>
        </div>
      ) : null}
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
