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
  const entries = getContextEntries(context.entries, diff?.new.entries)

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

  let columns = 2
  if (diff !== undefined) {
    columns *= 2
  }

  return (
    <Table columns={columns} getActions={getActions}>
      <TableRow>
        <TableTextCell className="bg-fuchsia-100 text-black">
          Name
        </TableTextCell>
        {diff !== undefined && (
          <TableTextCell className="bg-fuchsia-100 text-black">
            Name (diff)
          </TableTextCell>
        )}
        <TableTextCell className="bg-fuchsia-100 text-black">
          Value
        </TableTextCell>
        {diff !== undefined && (
          <TableTextCell className="bg-fuchsia-100 text-black">
            Value (diff)
          </TableTextCell>
        )}
      </TableRow>
      {entries.map(({ old: entry, new: diffEntry }, i) => (
        <ContextRow
          key={entry.id}
          entry={entry}
          diff={
            diff !== undefined
              ? {
                  new: diffEntry,
                  update: (updated) =>
                    diff.update({
                      ...diff.new,
                      entries: diff.new.entries.map((e) =>
                        e.id === updated.id ? updated : e
                      ),
                    }),
                }
              : undefined
          }
          prevEntries={entries
            .slice(0, i)
            .map((e) => e.old.name)
            .filter(Boolean)}
          isLast={i === entries.length - 1}
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
    new: ContextEntry | undefined
    update: (newValue: ContextEntry) => void
  }
  prevEntries: string[]
  isLast: boolean
  updateName: (newValue: string) => void
  updateExpression: (newValue: string) => void
}) {
  const knownNames = useKnownNames(prevEntries)

  const diffClass = (oldValue: string, newValue: string | undefined) => {
    const rowDeleted = diff?.new === undefined

    if (rowDeleted) {
      return 'bg-red-100'
    }

    if (oldValue !== newValue) {
      return 'bg-emerald-100'
    }

    return ''
  }

  return (
    <TableRow>
      {isLast ? (
        <TableTextCell className="bg-cyan-100 text-black">return</TableTextCell>
      ) : (
        <TableInputCell
          value={entry.name}
          onChange={(v) => updateName(v.replace(/ /g, '_'))}
          disabled={diff !== undefined}
          className={diff !== undefined ? 'bg-gray-100' : ''}
        />
      )}
      {diff !== undefined &&
        (isLast ? (
          <TableTextCell className="bg-cyan-100 text-black">
            return
          </TableTextCell>
        ) : (
          <TableInputCell
            className={diffClass(entry.name, diff.new?.name)}
            value={diff.new?.name ?? ''}
            onChange={(v) => {
              if (diff.new === undefined) {
                return
              }

              diff.update({ ...diff.new, name: v.replace(/ /g, '_') })
            }}
            disabled={diff.new === undefined}
          />
        ))}
      <TableFeelCell
        value={entry.expression.text}
        onChange={(v) => updateExpression(v)}
        dialect="expression"
        knownNames={knownNames}
        disabled={diff !== undefined}
        className={diff !== undefined ? 'bg-gray-100' : ''}
      />
      {diff !== undefined && (
        <TableFeelCell
          className={diffClass(
            entry.expression.text,
            diff.new?.expression.text
          )}
          value={diff.new?.expression.text ?? ''}
          onChange={(v) => {
            if (diff.new === undefined) {
              return
            }
            diff.update({ ...diff.new, expression: { text: v } })
          }}
          dialect="expression"
          knownNames={knownNames}
          disabled={diff.new === undefined}
        />
      )}
    </TableRow>
  )
}

export function getContextEntries(
  original: ContextEntry[],
  diff?: ContextEntry[]
) {
  const entries: { old: ContextEntry; new?: ContextEntry }[] = []

  if (diff !== undefined) {
    for (const entry of diff) {
      const old = original.find((e) => e.id === entry.id)

      entries.push({
        old: old ?? createEntry({ id: entry.id }),
        new: entry,
      })
    }
  }

  for (let i = 0; i < original.length; i++) {
    const entry = original[i]

    if (entries.find((e) => e.old.id === entry.id)) {
      continue
    }

    // find the previous original entry to insert after
    let prevIndex = -1
    for (let j = i - 1; j >= 0; j--) {
      const prevEntry = original[j]
      const idx = entries.findIndex((e) => e.old.id === prevEntry.id)
      if (idx !== -1) {
        prevIndex = idx
        break
      }
    }

    entries.splice(prevIndex + 1, 0, {
      old: entry,
      new: undefined,
    })
  }

  return entries
}
