import { cn } from '@/lib/utils'
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useState,
  useEffect,
  useRef,
  type PropsWithChildren,
  type ReactNode,
} from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger,
} from './ui/context-menu'

type InputCellProps = {
  value: string
  onChange: (value: string) => void
  className?: string
}

export function TableInputCell({ value, onChange, className }: InputCellProps) {
  return (
    <TextBox
      className={cn(
        'block border rounded-none m-0 p-2 w-full box-border',
        className
      )}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, ''))}
    />
  )
}

type TableTextCellProps = PropsWithChildren<{
  className?: string
}>

export function TableTextCell({ children, className }: TableTextCellProps) {
  return (
    <div
      className={cn(
        'bg-primary text-primary-foreground border p-2 w-full break-words h-full',
        className
      )}
    >
      {children}
    </div>
  )
}

export function TableRow({ children }: PropsWithChildren) {
  const { columnWidths } = useTableContext()

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: columnWidths.map((w) => `${w}px`).join(' '),
      }}
    >
      {Children.map(children, (child, index) => {
        if (isValidElement(child)) {
          return <TableCell x={index} y={0}>{cloneElement(child)}</TableCell>
        }
        return child
      })}
    </div>
  )
}

type GetActions = (
  x: number,
  y: number
) => { name: string; action: () => void }[][]

type TableContext = {
  columnWidths: number[]
  setColumnWidth: (index: number, width: number) => void
  columnCount: number
  getActions: GetActions
}

const TableContext = createContext<TableContext | undefined>(undefined)

type TableProps = PropsWithChildren<{
  columns: number
  getActions?: GetActions
}>

const MIN_COLUMN_WIDTH = 50

export function Table({ children, columns, getActions }: TableProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [columnWidths, setColumnWidths] = useState<number[]>([])

  useEffect(() => {
    if (containerRef.current) {
      const width = containerRef.current.clientWidth / columns
      setColumnWidths(Array(columns).fill(width))
    }
  }, [columns])

  const setColumnWidth = (index: number, width: number) => {
    setColumnWidths((prev) => {
      const next = [...prev]
      next[index] = Math.max(MIN_COLUMN_WIDTH, width)
      return next
    })
  }

  return (
    <TableContext.Provider
      value={{
        columnWidths,
        setColumnWidth,
        columnCount: columns,
        getActions: getActions ?? (() => []),
      }}
    >
      <div ref={containerRef} className="flex flex-col">
        {children}
      </div>
    </TableContext.Provider>
  )
}

export function useTableContext(): TableContext {
  const context = useContext(TableContext)

  if (context === undefined) {
    throw new Error("'useTableContext' must be used within the Table")
  }

  return context
}

type TableCellProps = {
  children: ReactNode
  x: number
  y: number
  className?: string
}

function TableCell({ children, x, y, className }: TableCellProps) {
  const { getActions } = useTableContext()
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div className={cn('relative', className)}>
          {children}
          <ResizeHandle columnIndex={x} />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {getActions(x, x).map((actions, i) => (
          <ContextMenuGroup key={i}>
            {actions.map(({ name, action }) => (
              <ContextMenuItem key={name} onClick={action}>
                {name}
              </ContextMenuItem>
            ))}
          </ContextMenuGroup>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}

type ResizeHandleProps = {
  columnIndex: number
}

function ResizeHandle({ columnIndex }: ResizeHandleProps) {
  const { setColumnWidth, columnWidths } = useTableContext()
  const [isDragging, setIsDragging] = useState(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    startX.current = e.clientX
    startWidth.current = columnWidths[columnIndex]
  }

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX.current
      setColumnWidth(columnIndex, startWidth.current + delta)
    }

    const handleMouseUp = () => setIsDragging(false)

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, columnIndex, setColumnWidth])

  return (
    <div
      className={cn(
        'absolute right-0 top-0 h-full w-1 cursor-col-resize',
        'bg-transparent hover:bg-primary',
        isDragging && 'bg-primary'
      )}
      onMouseDown={handleMouseDown}
    />
  )
}

const TEXT_LINE_HEIGHT = 19

type TextBoxProps = React.ComponentProps<'textarea'>

export function TextBox({ value, style, ...props }: TextBoxProps) {
  const { columnWidths } = useTableContext()
  const ref = useRef<HTMLTextAreaElement>(null)

  const recalculateHeight = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = '0'
    textarea.style.minHeight = '0'
    const scrollHeight = textarea.scrollHeight
    textarea.style.minHeight = `${scrollHeight}px`
    textarea.style.height = '100%'
  }

  useEffect(() => {
    const textarea = ref.current
    if (textarea) {
      recalculateHeight(textarea)
    }
  }, [columnWidths, value])

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      {...props}
      style={{
        height: '100%',
        minHeight: 0,
        resize: 'none',
        lineHeight: TEXT_LINE_HEIGHT + 'px',
        overflow: 'hidden',
        ...style,
      }}
    />
  )
}
