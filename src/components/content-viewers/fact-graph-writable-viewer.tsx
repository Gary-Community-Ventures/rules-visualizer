import type { NodeContent } from '@/lib/model'

type Props = {
  content: Extract<NodeContent, { format: 'factGraph'; type: 'writable' }>
}

export function FactGraphWritableViewer({ content }: Props) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <Field label="Path" value={content.path} />
      <Field label="Type" value={content.typeName} />

      {content.collectionItemAlias && (
        <Field
          label="Collection Item Alias"
          value={content.collectionItemAlias}
        />
      )}

      {content.enumOptions && content.enumOptions.length > 0 && (
        <div>
          <span className="text-muted-foreground font-medium">Options</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {content.enumOptions.map((opt) => (
              <span
                key={opt}
                className="rounded-full bg-muted px-2 py-0.5 text-xs"
              >
                {opt}
              </span>
            ))}
          </div>
        </div>
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
