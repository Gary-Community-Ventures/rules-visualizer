import { Table, TableInputCell, TableRow } from '../table'

type TextInputProps = {
  text: string
  updateText: (name: string) => void
  diff?: {
    text: string
    update: (newValue: string) => void
  }
}

export function TextInput({ text, updateText, diff }: TextInputProps) {
  let columns = 1
  if (diff !== undefined) {
    columns++
  }

  return (
    <Table columns={columns}>
      <TableRow>
        <TableInputCell
          value={text}
          onChange={(v) => updateText(v)}
          disabled={diff !== undefined}
          className={diff !== undefined ? 'bg-gray-100' : ''}
        />
        {diff !== undefined && (
          <TableInputCell value={diff.text} onChange={(v) => diff.update(v)} />
        )}
      </TableRow>
    </Table>
  )
}
