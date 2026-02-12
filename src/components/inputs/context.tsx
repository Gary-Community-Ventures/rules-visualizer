import type { Context } from '@/lib/model'
import { Table, TableInputCell, TableRow, TableTextCell } from '../table'

type ContextInputProps = {
  context: Context
  updateContext: (context: Context) => void
}

export function ContextInput({ context, updateContext }: ContextInputProps) {
  const updateName = (index: number, name: string) => {
    const entries = [...context.entries]
    entries[index] = { ...entries[index], name }
    updateContext({ ...context, entries })
  }
  const updateExpression = (index: number, expression: string) => {
    const entries = [...context.entries]
    entries[index] = {
      ...entries[index],
      expression: { ...entries[index].expression, text: expression },
    }
    updateContext({ ...context, entries })
  }

  return (
    <Table columns={2}>
      <TableRow>
        <TableTextCell>Name</TableTextCell>
        <TableTextCell>Value</TableTextCell>
      </TableRow>
      {context.entries.map(({ name, expression }, i) => (
        <TableRow key={i}>
          {i < context.entries.length - 1 ? (
            <TableInputCell
              value={name}
              onChange={(v) => {
                updateName(i, v)
              }}
            />
          ) : (
            <TableTextCell>return</TableTextCell>
          )}
          <TableInputCell
            value={expression.text}
            onChange={(v) => updateExpression(i, v)}
          />
        </TableRow>
      ))}
    </Table>
  )
}
