import { useEffect, useRef, useState } from 'react'
import { Input } from '../ui/input'
import { parseInputValue, displayInputValue } from '@/lib/parse-input'

/**
 * Input that stores raw text locally and only parses on blur.
 * Prevents parseInputValue from mangling intermediate states like "1." → "1".
 */
export function ParsedInput({
  value,
  onChange,
  className,
  placeholder,
}: {
  value: unknown
  onChange: (parsed: unknown) => void
  className?: string
  placeholder?: string
}) {
  const [raw, setRaw] = useState(() => displayInputValue(value))
  const prevValue = useRef(value)

  // Sync from parent when value changes externally (not from our own blur)
  useEffect(() => {
    if (prevValue.current !== value) {
      setRaw(displayInputValue(value))
      prevValue.current = value
    }
  }, [value])

  return (
    <Input
      placeholder={placeholder}
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={() => {
        const parsed = parseInputValue(raw)
        prevValue.current = parsed
        onChange(parsed)
      }}
      className={className}
    />
  )
}
