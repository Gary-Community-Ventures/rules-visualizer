import type { NodeContent } from '@/lib/model'

type Props = {
  content: Extract<NodeContent, { format: 'factGraph'; type: 'derived' }>
}

export function FactGraphDerivedViewer({ content }: Props) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <span className="text-muted-foreground font-medium">Path</span>
        <p className="mt-0.5">{content.path}</p>
      </div>
      <div>
        <span className="text-muted-foreground font-medium">Data Type</span>
        <p className="mt-0.5">{content.dataType}</p>
      </div>
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
