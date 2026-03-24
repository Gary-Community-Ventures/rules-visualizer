import type { NodeContent } from '@/lib/model'

type Props = {
  content: Extract<NodeContent, { format: 'rac'; type: 'variable' }>
}

export function RacVariableViewer({ content }: Props) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <Field label="Path" value={content.path} />
      <Field label="Data Type" value={content.dataType} />
      {content.expression && (
        <div>
          <span className="text-muted-foreground font-medium">Expression</span>
          <pre className="mt-1 rounded-md border bg-muted/50 p-2 text-xs whitespace-pre-wrap">
            {content.expression}
          </pre>
        </div>
      )}
      {content.source && <Field label="Source" value={content.source} />}
      {content.temporalValues && content.temporalValues.length > 0 && (
        <div>
          <span className="text-muted-foreground font-medium">
            Temporal Values
          </span>
          <div className="mt-1 space-y-1">
            {content.temporalValues.map((tv, i) => (
              <div
                key={i}
                className="rounded-md border bg-muted/30 p-2 text-xs"
              >
                <span className="font-medium">
                  {tv.from}
                  {tv.to ? ` – ${tv.to}` : ' – present'}
                </span>
                <pre className="mt-1 whitespace-pre-wrap">{tv.expression}</pre>
              </div>
            ))}
          </div>
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
