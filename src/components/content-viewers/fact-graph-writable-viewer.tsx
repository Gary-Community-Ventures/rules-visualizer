import type { NodeContent } from '@/lib/model'

type Props = {
  content: Extract<NodeContent, { format: 'factGraph'; type: 'writable' }>
}

export function FactGraphWritableViewer({ content }: Props) {
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
    </div>
  )
}
