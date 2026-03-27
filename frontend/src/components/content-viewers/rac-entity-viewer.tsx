import type { NodeContent } from '@/lib/model'

type Props = {
  content: Extract<NodeContent, { format: 'rac'; type: 'entity' }>
}

export function RacEntityViewer({ content }: Props) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <span className="text-muted-foreground font-medium">Fields</span>
      {content.fields.length === 0 ? (
        <p className="text-xs text-muted-foreground">No fields defined.</p>
      ) : (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b">
              <th className="text-left py-1 pr-3 font-medium text-muted-foreground">
                Name
              </th>
              <th className="text-left py-1 pr-3 font-medium text-muted-foreground">
                Type
              </th>
              <th className="text-left py-1 font-medium text-muted-foreground">
                Nullable
              </th>
            </tr>
          </thead>
          <tbody>
            {content.fields.map((field, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-1 pr-3">{field.name}</td>
                <td className="py-1 pr-3 font-mono">{field.dtype}</td>
                <td className="py-1">{field.nullable ? 'yes' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {content.foreignKeys && content.foreignKeys.length > 0 && (
        <>
          <span className="text-muted-foreground font-medium">
            Foreign Keys
          </span>
          <ul className="text-xs list-disc list-inside">
            {content.foreignKeys.map((fk, i) => (
              <li key={i}>
                {fk.field} → {fk.target}
              </li>
            ))}
          </ul>
        </>
      )}

    </div>
  )
}
