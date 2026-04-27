import { useState } from 'react'
import { Input } from './ui/input'
import { cn } from '@/lib/utils'

type BaseInputProps = {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  /** Size/layout classes (height, width, text size). Coloring for filled
   *  state is handled internally based on isOverride. */
  className?: string
  /** When true the filled-state ring is yellow (override/pin) instead of
   *  blue (input/value). */
  isOverride?: boolean
}

function filledRing(hasValue: boolean, isOverride?: boolean) {
  if (!hasValue) return undefined
  return isOverride
    ? 'border-yellow-400 ring-1 ring-yellow-400'
    : 'border-blue-400 ring-1 ring-blue-400'
}

/** Tri-state boolean: blank (unset), true, false. <select> keeps the blank
 *  state representable, which a checkbox can't. */
export function BooleanInput({
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  isOverride,
}: BaseInputProps) {
  const [focused, setFocused] = useState(false)
  const emptyLabel =
    focused || value !== '' ? '(empty)' : (placeholder ?? '(empty)')
  return (
    <select
      className={cn(
        'flex w-full rounded-md border border-input bg-transparent px-2 py-1 font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        value === '' && 'text-muted-foreground',
        filledRing(value !== '', isOverride),
        className
      )}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        onBlur?.()
      }}
    >
      <option value="" className="text-muted-foreground">
        {emptyLabel}
      </option>
      <option value="true">true</option>
      <option value="false">false</option>
    </select>
  )
}

/** Native date picker. Factgraph Day is ISO YYYY-MM-DD, which matches the
 *  browser's date-input value format. */
export function DayInput({
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  isOverride,
}: BaseInputProps) {
  return (
    <Input
      type="date"
      className={cn(
        'font-mono',
        filledRing(value !== '', isOverride),
        className
      )}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    />
  )
}

/** Currency field: numeric step=0.01 with a $ prefix. Like step=1 on
 *  Int, step=0.01 alone doesn't stop browsers from accepting extra
 *  decimals — we reject any value with more than two fractional digits. */
export function DollarInput({
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  isOverride,
}: BaseInputProps) {
  return (
    <div className={cn('relative', className?.includes('flex-1') && 'flex-1')}>
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none text-xs">
        $
      </span>
      <Input
        type="text"
        inputMode="decimal"
        className={cn(
          'pl-5 font-mono',
          filledRing(value !== '', isOverride),
          className
        )}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          const next = e.target.value
          if (next === '' || /^-?\d*(\.\d{0,2})?$/.test(next)) onChange(next)
        }}
        onBlur={onBlur}
      />
    </div>
  )
}

/** Integer-valued input (covers Int, Short, Byte). step=1 alone doesn't
 *  stop browsers from accepting decimal input, so we also reject any value
 *  that isn't an optional leading minus followed by digits. */
export function IntegerInput({
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  isOverride,
}: BaseInputProps) {
  return (
    <Input
      type="text"
      inputMode="numeric"
      className={cn(
        'font-mono',
        filledRing(value !== '', isOverride),
        className
      )}
      placeholder={placeholder}
      value={value}
      onChange={(e) => {
        const next = e.target.value
        if (next === '' || /^-?\d+$/.test(next)) onChange(next)
      }}
      onBlur={onBlur}
    />
  )
}

/** Rational is stored as "n/d" where n and d are Ints. Render as two
 *  side-by-side integer inputs with a slash between them. */
export function RationalInput({
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  isOverride,
}: BaseInputProps) {
  const [rawNum = '', rawDen = ''] = value.split('/')
  const emit = (num: string, den: string) => {
    if (num === '' && den === '') onChange('')
    else onChange(`${num}/${den}`)
  }
  const acceptInt = (s: string) => s === '' || /^-?\d*$/.test(s)
  // Split a caller-supplied placeholder like "1/2" into per-side hints so
  // the computed-value placeholder shows on both inputs, not just the num.
  const [numPlaceholder = 'n', denPlaceholder = 'd'] = (
    placeholder ?? ''
  ).includes('/')
    ? (placeholder as string).split('/')
    : ['n', 'd']
  const part =
    'h-full w-full min-w-0 bg-transparent px-2 py-1 font-mono text-center focus:outline-none'
  return (
    <div
      className={cn(
        'flex items-center rounded-md border border-input bg-transparent shadow-sm focus-within:ring-1 focus-within:ring-ring',
        filledRing(value !== '', isOverride),
        className
      )}
    >
      <input
        type="text"
        inputMode="numeric"
        className={part}
        placeholder={numPlaceholder}
        value={rawNum}
        onChange={(e) => {
          const n = e.target.value
          if (acceptInt(n)) emit(n, rawDen)
        }}
        onBlur={onBlur}
      />
      <span className="text-muted-foreground select-none">/</span>
      <input
        type="text"
        inputMode="numeric"
        className={part}
        placeholder={denPlaceholder}
        value={rawDen}
        onChange={(e) => {
          const d = e.target.value
          if (acceptInt(d)) emit(rawNum, d)
        }}
        onBlur={onBlur}
      />
    </div>
  )
}

/** Dropdown for Enum fields with known static options. Falls back to
 *  TextInput when no options are available (e.g. conditional EnumOptions). */
export function EnumInput({
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  isOverride,
  options,
}: BaseInputProps & { options: string[] }) {
  const [focused, setFocused] = useState(false)
  const emptyLabel =
    focused || value !== '' ? '(empty)' : (placeholder ?? '(empty)')
  return (
    <select
      className={cn(
        'flex w-full rounded-md border border-input bg-transparent px-2 py-1 font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        value === '' && 'text-muted-foreground',
        filledRing(value !== '', isOverride),
        className
      )}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        onBlur?.()
      }}
    >
      <option value="" className="text-muted-foreground">
        {emptyLabel}
      </option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  )
}

/** Plain text fallback for String, Rational, Enum (without options), and
 *  every structured value type we don't yet render specially. */
export function TextInput({
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  isOverride,
}: BaseInputProps) {
  return (
    <Input
      className={cn(
        'font-mono',
        filledRing(value !== '', isOverride),
        className
      )}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    />
  )
}

type TypedValueInputProps = BaseInputProps & {
  typeName?: string
  /** Option values for Enum fields. When provided, the Enum case renders a
   *  dropdown; otherwise it falls back to TextInput. */
  enumOptions?: string[]
}

/**
 * Dispatch to the typed input for the given fact-graph type name. Strings
 * are stored as their user-visible form ("true", "2026-04-24", "123.45") —
 * the executor parses them at submit time.
 */
export function TypedValueInput({
  typeName,
  enumOptions,
  ...rest
}: TypedValueInputProps) {
  switch (typeName) {
    case 'Boolean':
      return <BooleanInput {...rest} />
    case 'Day':
      return <DayInput {...rest} />
    case 'Dollar':
      return <DollarInput {...rest} />
    case 'Int':
    case 'Short':
    case 'Byte':
      return <IntegerInput {...rest} />
    case 'Rational':
      return <RationalInput {...rest} />
    case 'Enum':
      if (enumOptions && enumOptions.length > 0) {
        return <EnumInput {...rest} options={enumOptions} />
      }
      return <TextInput {...rest} />
    default:
      return <TextInput {...rest} />
  }
}
