import { useState } from 'react'
import type { NodeContent } from '@/lib/model'

type Props = {
  content: Extract<NodeContent, { format: 'factGraph'; type: 'writable' }>
}

export function FactGraphWritableViewer({ content }: Props) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      {content.enumOptionsPath && (
        <Field label="Options Path" value={content.enumOptionsPath} />
      )}

      {content.collectionItemPath && (
        <Field label="Collection" value={content.collectionItemPath} />
      )}

      {content.limits && content.limits.length > 0 && (
        <div>
          <span className="text-muted-foreground font-medium">Validation</span>
          <ul className="mt-1 text-xs list-disc list-inside">
            {content.limits.map((limit, i) => (
              <li key={i}>
                {limit.type}: {limit.value}
              </li>
            ))}
          </ul>
        </div>
      )}

      {content.logic && (
        <div>
          <span className="text-muted-foreground font-medium">Logic</span>
          <pre className="mt-1 rounded-md border bg-muted/50 p-2 text-xs whitespace-pre-wrap font-mono">
            {content.logic}
          </pre>
        </div>
      )}

      <AdvancedSection>
        <Field label="Type" value={content.typeName} />
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
