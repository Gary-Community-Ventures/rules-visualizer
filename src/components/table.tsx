import { cn } from '@/lib/utils'
import { createContext, useContext, type PropsWithChildren } from 'react'

export function Test() {
  return (
    <div className="p-10">
      <Table>
        <TableRow>
          <TableInputCell
            value="testtesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttest"
            onChange={() => {}}
          />
          <TableInputCell value="test" onChange={() => {}} />
          <TableInputCell value="test" onChange={() => {}} />
          <TableInputCell value="test" onChange={() => {}} />
        </TableRow>
        <TableRow>
          <TableInputCell value="test" onChange={() => {}} />
          <TableInputCell value="test" onChange={() => {}} />
          <TableInputCell value="test" onChange={() => {}} />
          <TableInputCell value="test" onChange={() => {}} />
        </TableRow>
        <TableRow>
          <TableInputCell value="test" onChange={() => {}} />
          <TableInputCell value="test" onChange={() => {}} />
          <TableInputCell value="test" onChange={() => {}} />
          <TableInputCell value="test" onChange={() => {}} />
        </TableRow>
      </Table>
    </div>
  )
}

type InputCellProps = {
  value: string
  onChange: (value: string) => void
  className?: string
}
export function TableInputCell({ value, onChange, className }: InputCellProps) {
  return (
    <textarea
      className={cn(
        'inline-block border rounded-none m-0 resize-none w-full h-fit',
        className
      )}
      value={value}
      onChange={(e) => {
        const value = e.target.value.replace(/\n/g, '')
        onChange(value)
      }}
    />
  )
}

export function TableRow({ children }: PropsWithChildren) {
  return <div className="flex flex-nowrap">{children}</div>
}

type TableContext = {
  widths: number[]
  heights: number[]
}

const TableContext = createContext<TableContext | undefined>(undefined)

export function Table({ children }: PropsWithChildren) {
  return <div className="flex flex-col">{children}</div>
}

export function useTableContext(): TableContext {
  const context = useContext(TableContext)

  if (context === undefined) {
    throw new Error("'useTableContext' must be used within the Table")
  }

  return context
}
