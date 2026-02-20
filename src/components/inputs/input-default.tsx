import type { Input } from '@/lib/model'
import { Table, TableFeelCell, TableRow } from '../table'

type InputDefaultProps = {
  input: Input
  updateInput: (input: Input) => void
  diff?: {
    new: Input
    update: (newValue: Input) => void
  }
}

export function InputDefault({
  input,
  updateInput,
  diff,
}: InputDefaultProps) {
  let columns = 1
  if (diff !== undefined) {
    columns++
  }

  return (
    <Table columns={columns}>
      <TableRow>
        <TableFeelCell
          value={input.defaultValue}
          onChange={(v) => updateInput({ ...input, defaultValue: v })}
          dialect="expression"
          disabled={diff !== undefined}
          className={diff !== undefined ? 'bg-gray-100' : ''}
        />
        {diff !== undefined && (
          <TableFeelCell
            className={diff.new.defaultValue !== input.defaultValue ? 'bg-emerald-100' : ''}
            value={diff.new.defaultValue}
            onChange={(v) => diff.update({ ...diff.new, defaultValue: v })}
            dialect="expression"
            disabled={diff.new === undefined}
          />
        )}
      </TableRow>
    </Table>
  )
}
