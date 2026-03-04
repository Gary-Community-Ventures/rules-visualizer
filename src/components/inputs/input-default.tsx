import type { Input } from '@/lib/model'
import { useModelContext } from '@/context/model-context'
import { StructInput } from './struct-input'
import { Table, TableFeelCell, TableRow } from '../table'

type InputDefaultProps = {
  input: Input
  updateInput: (input: Input) => void
  typeRef?: string
  diff?: {
    new: Input
    update: (newValue: Input) => void
  }
}

function parseDefault(value: string): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function serializeDefault(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function InputDefault({
  input,
  updateInput,
  typeRef,
  diff,
}: InputDefaultProps) {
  const { customTypes } = useModelContext()
  const isCustomType =
    typeRef !== undefined && customTypes.some((ct) => ct.name === typeRef)

  if (isCustomType) {
    if (diff) {
      return (
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Original
            </label>
            <div className="opacity-60 pointer-events-none">
              <StructInput
                value={parseDefault(input.defaultValue)}
                onChange={() => {}}
                typeRef={typeRef}
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Proposed Changes
            </label>
            <StructInput
              value={parseDefault(diff.new.defaultValue)}
              onChange={(v) =>
                diff.update({ ...diff.new, defaultValue: serializeDefault(v) })
              }
              typeRef={typeRef}
            />
          </div>
        </div>
      )
    }
    return (
      <StructInput
        value={parseDefault(input.defaultValue)}
        onChange={(v) =>
          updateInput({ ...input, defaultValue: serializeDefault(v) })
        }
        typeRef={typeRef}
      />
    )
  }

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
            className={
              diff.new.defaultValue !== input.defaultValue
                ? 'bg-emerald-100'
                : ''
            }
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
