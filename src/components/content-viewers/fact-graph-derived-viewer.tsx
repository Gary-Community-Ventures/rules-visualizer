import type { NodeContent } from '@/lib/model'

type Props = {
  content: Extract<NodeContent, { format: 'factGraph'; type: 'derived' }>
}

export function FactGraphDerivedViewer({ content }: Props) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <Field label="Path" value={content.path} />
      {content.complete !== undefined && (
        <Field label="Complete" value={content.complete ? 'Yes' : 'No'} />
      )}
      {content.computation && (
        <div>
          <span className="text-muted-foreground font-medium">Computation</span>
          <pre className="mt-1 rounded-md border bg-muted/50 p-2 text-xs whitespace-pre-wrap">
            {content.computation}
          </pre>
        </div>
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
