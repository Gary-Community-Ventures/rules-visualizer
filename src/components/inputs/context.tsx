import type { Context, ContextEntry } from '@/lib/model'
import { createEntry } from '@/lib/model'
import { useKnownNames } from '@/lib/use-known-names'
import {
  Table,
  TableFeelCell,
  TableInputCell,
  TableRow,
  TableTextCell,
} from '../table'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from 'lucide-react'

type ContextInputProps = {
  context: Context
  updateContext: (context: Context) => void
  diff?: {
    new: Context
    update: (newValue: Context) => void
  }
}

export function ContextInput({
  context,
  updateContext,
  diff,
}: ContextInputProps) {
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

  const insertRowAbove = (entryIndex: number) => {
    const entries = [...context.entries]
    entries.splice(entryIndex, 0, createEntry())
    updateContext({ ...context, entries })
  }

  const insertRowBelow = (entryIndex: number) => {
    const entries = [...context.entries]
    entries.splice(entryIndex + 1, 0, createEntry())
    updateContext({ ...context, entries })
  }

  const deleteRow = (entryIndex: number) => {
    const entries = context.entries.filter((_, i) => i !== entryIndex)
    updateContext({ ...context, entries })
  }

  const shiftUp = (entryIndex: number) => {
    const entries = [...context.entries]
    ;[entries[entryIndex - 1], entries[entryIndex]] = [
      entries[entryIndex],
      entries[entryIndex - 1],
    ]
    updateContext({ ...context, entries })
  }

  const shiftDown = (entryIndex: number) => {
    const entries = [...context.entries]
    ;[entries[entryIndex], entries[entryIndex + 1]] = [
      entries[entryIndex + 1],
      entries[entryIndex],
    ]
    updateContext({ ...context, entries })
  }

  const getActions = (_x: number, y: number) => {
    // y=0 is header row, y=entries.length is return row
    const isHeader = y === 0
    const isReturnRow = y === context.entries.length
    const entryIndex = y - 1

    // Header can only insert below (at index 0)
    if (isHeader) {
      return [
        [
          {
            name: 'Insert row below',
            action: () => insertRowAbove(0),
            Icon: PlusIcon,
          },
        ],
      ]
    }

    // Return row can only insert above
    if (isReturnRow) {
      return [
        [
          {
            name: 'Insert row above',
            action: () => insertRowAbove(entryIndex),
            Icon: PlusIcon,
          },
        ],
      ]
    }

    const isFirstDataRow = y === 1
    const isLastDataRow = y === context.entries.length - 1

    const insertActions = [
      {
        name: 'Insert row above',
        action: () => insertRowAbove(entryIndex),
        Icon: PlusIcon,
      },
      ...(!isLastDataRow
        ? [
            {
              name: 'Insert row below',
              action: () => insertRowBelow(entryIndex),
              Icon: PlusIcon,
            },
          ]
        : []),
    ]

    const shiftActions = [
      ...(!isFirstDataRow
        ? [
            {
              name: 'Shift up',
              action: () => shiftUp(entryIndex),
              Icon: ArrowUpIcon,
            },
          ]
        : []),
      ...(!isLastDataRow
        ? [
            {
              name: 'Shift down',
              action: () => shiftDown(entryIndex),
              Icon: ArrowDownIcon,
            },
          ]
        : []),
    ]

    const deleteActions = [
      {
        name: 'Delete row',
        action: () => deleteRow(entryIndex),
        Icon: TrashIcon,
        variant: 'destructive' as const,
      },
    ]

    return [
      insertActions,
      ...(shiftActions.length > 0 ? [shiftActions] : []),
      deleteActions,
    ]
  }

  return (
    <Table columns={2} getActions={getActions}>
      <TableRow>
        <TableTextCell className="bg-fuchsia-100 text-black">
          Name
        </TableTextCell>
        <TableTextCell className="bg-fuchsia-100 text-black">
          Value
        </TableTextCell>
      </TableRow>
      {context.entries.map((entry, i) => (
        <ContextRow
          key={i}
          entry={entry}
          prevEntries={context.entries
            .slice(0, i)
            .map((e) => e.name)
            .filter(Boolean)}
          isLast={i === context.entries.length - 1}
          updateName={(v) => updateName(i, v)}
          updateExpression={(v) => updateExpression(i, v)}
        />
      ))}
    </Table>
  )
}

function ContextRow({
  entry,
  diff,
  prevEntries,
  isLast,
  updateName,
  updateExpression,
}: {
  entry: ContextEntry
  diff?: {
    new: ContextEntry
    update: (newValue: ContextEntry) => void
  }
  prevEntries: string[]
  isLast: boolean
  updateName: (newValue: string) => void
  updateExpression: (newValue: string) => void
}) {
  const knownNames = useKnownNames(prevEntries)

  return (
    <TableRow>
      {isLast ? (
        <TableTextCell className="bg-cyan-100 text-black">return</TableTextCell>
      ) : (
        <TableInputCell
          className="font-mono"
          value={entry.name}
          onChange={(v) => {
            updateName(v.replace(/ /g, '_'))
          }}
        />
      )}
      <TableFeelCell
        value={entry.expression.text}
        onChange={(v) => updateExpression(v)}
        dialect="expression"
        knownNames={knownNames}
      />
    </TableRow>
  )
}
