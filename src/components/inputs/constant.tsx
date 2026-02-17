import type { Constant } from '@/lib/model'
import { Table, TableInputCell, TableRow } from '../table'

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
        <TableInputCell
          value={constant.text}
          onChange={(v) => updateConstant({ ...constant, text: v })}
          disabled={diff !== undefined}
          className={diff !== undefined ? 'bg-gray-100' : ''}
        />
        {diff !== undefined && (
          <TableInputCell
            value={diff.new.text}
            onChange={(v) => diff.update({ ...constant, text: v })}
          />
        )}
      </TableRow>
    </Table>
  )
}
