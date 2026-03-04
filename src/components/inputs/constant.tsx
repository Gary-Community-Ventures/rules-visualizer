import type { Constant } from '@/lib/model'
import { Table, TableFeelCell, TableRow } from '../table'

type ConstantInputProps = {
  constant: Constant
  updateConstant: (constant: Constant) => void
  diff?: {
    new: Constant
    update: (newValue: Constant) => void
  }
}

export function ConstantInput({
  constant,
  updateConstant,
  diff,
}: ConstantInputProps) {
  let columns = 1
  if (diff !== undefined) {
    columns++
  }

  return (
    <Table columns={columns}>
      <TableRow>
        <TableFeelCell
          value={constant.text}
          onChange={(v) => updateConstant({ ...constant, text: v })}
          dialect="expression"
          disabled={diff !== undefined}
          className={diff !== undefined ? 'bg-gray-100' : ''}
        />
        {diff !== undefined && (
          <TableFeelCell
            className={
              diff.new.text !== constant.text ? 'bg-emerald-100' : ''
            }
            value={diff.new.text}
            onChange={(v) => diff.update({ ...diff.new, text: v })}
            dialect="expression"
          />
        )}
      </TableRow>
    </Table>
  )
}
