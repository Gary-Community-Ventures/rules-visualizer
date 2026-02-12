import type { Context } from '@/lib/model'
import { Table, TableInputCell, TableRow, TableTextCell } from '../table'

type ContextInputProps = {
  context: Context
  updateContext: (context: Context) => void
}

export function ContextInput({ context }: ContextInputProps) {
  return (
    <Table columns={2}>
      <TableRow>
        <TableTextCell>Name</TableTextCell>
        <TableTextCell>Value</TableTextCell>
      </TableRow>
      {context.entries.map(({ name, expression }, i) => (
        <TableRow key={name}>
          {i < context.entries.length - 1 ? (
            <TableInputCell value={name} onChange={() => {}} />
          ) : (
            <TableTextCell>return</TableTextCell>
          )}
          <TableInputCell value={expression.text} onChange={() => {}} />
        </TableRow>
      ))}
    </Table>
  )
}
