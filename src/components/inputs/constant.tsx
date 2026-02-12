import type { Constant } from '@/lib/model'
import { Table, TableInputCell, TableRow } from '../table'

type ConstantInputProps = {
  constant: Constant
  updateConstant: (constant: Constant) => void
}
export function ConstantInput({
  constant,
  updateConstant,
}: ConstantInputProps) {
  return (
    <Table columns={1}>
      <TableRow>
        <TableInputCell
          value={constant.text}
          onChange={(v) => updateConstant({ ...constant, text: v })}
        />
      </TableRow>
    </Table>
  )
}
