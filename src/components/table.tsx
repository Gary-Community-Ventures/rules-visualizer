import { cn } from '@/lib/utils'
import { FeelEditor } from './feel-editor'
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
  type ComponentType,
  Fragment,
} from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
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

export function TableFeelCell({
  value,
  onChange,
  className,
  dialect,
  knownNames,
}: {
  value: string
  onChange: (value: string) => void
  className?: string
  dialect?: 'expression' | 'unaryTests'
  knownNames?: string[]
}) {
  return (
    <FeelEditor
      className={cn('block border rounded-none m-0 w-full box-border', className)}
      value={value}
      onChange={onChange}
      dialect={dialect}
      knownNames={knownNames}
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

type TableRowProps = PropsWithChildren<{
  rowIndex?: number
}>

export function TableRow({ children, rowIndex = 0 }: TableRowProps) {
  const { columnWidths } = useTableContext()

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: columnWidths.map((w) => `${w}px`).join(' '),
      }}
    >
      {Children.map(children, (child, colIndex) => {
        if (isValidElement(child)) {
          return (
            <TableCell x={colIndex} y={rowIndex}>
              {cloneElement(child)}
            </TableCell>
          )
        }
        return child
      })}
    </div>
  )
}

type Action = {
  name: string
  Icon: ComponentType
  action: () => void
  variant?: 'default' | 'destructive'
}

type GetActions = (x: number, y: number) => Action[][]

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
const RELOAD_KEY = Math.random()

export function Table({ children, columns, getActions }: TableProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [columnWidths, setColumnWidths] = useState<number[]>([])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const initWidths = () => {
      const width = container.clientWidth / columns
      setColumnWidths(Array(columns).fill(width))
    }

    initWidths()

    const observer = new ResizeObserver(() => {
      // Scale existing widths proportionally to new container size
      setColumnWidths((prev) => {
        if (prev.length === 0) return prev
        const oldTotal = prev.reduce((sum, w) => sum + w, 0)
        const newTotal = container.clientWidth
        if (oldTotal < 1) {
          return Array(columns).fill(newTotal / columns)
        }
        const scale = newTotal / oldTotal
        return prev.map((w) => w * scale)
      })
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [columns, RELOAD_KEY])

  const setColumnWidth = (index: number, width: number) => {
    setColumnWidths((prev) => {
      const nextIndex = index + 1
      if (nextIndex >= prev.length) return prev

      const delta = width - prev[index]
      const newWidth = prev[index] + delta
      const newNextWidth = prev[nextIndex] - delta

      // Enforce minimum widths
      if (newWidth < MIN_COLUMN_WIDTH || newNextWidth < MIN_COLUMN_WIDTH) {
        return prev
      }

      const next = [...prev]
      next[index] = newWidth
      next[nextIndex] = newNextWidth
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
      <div ref={containerRef} className="flex flex-col w-full">
        {Children.map(children, (child, rowIndex) => {
          if (isValidElement(child)) {
            return cloneElement(child, { rowIndex } as { rowIndex: number })
          }
          return child
        })}
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
  const { getActions, columnCount } = useTableContext()
  const isLastColumn = x === columnCount - 1

  return (
    <ContextMenu>
      <ContextMenuTrigger className="h-full">
        <div className={cn('relative h-full', className)}>
          {children}
          {!isLastColumn && <ResizeHandle columnIndex={x} />}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {getActions(x, y).map((actions, i) => (
          <Fragment key={i}>
            {i > 0 && <ContextMenuSeparator />}
            <ContextMenuGroup key={i}>
              {actions.map(({ name, action, Icon, variant }) => (
                <ContextMenuItem key={name} onClick={action} variant={variant}>
                  <Icon />
                  {name}
                </ContextMenuItem>
              ))}
            </ContextMenuGroup>
          </Fragment>
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
