import { useEffect, useState } from 'react'
import { useModelContext } from '@/context/model-context'
import { coerceNumber } from '@/lib/coerce'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Code, FormInput } from 'lucide-react'
import { cn } from '@/lib/utils'

const MAX_NESTING_DEPTH = 3

type StructInputProps = {
  value: unknown
  onChange: (value: unknown) => void
  typeRef: string
  compact?: boolean
  /** @internal tracks nesting depth to prevent infinite recursion */
  _depth?: number
}

export function StructInput({
  value,
  onChange,
  typeRef,
  compact = false,
  _depth = 0,
}: StructInputProps) {
  const { customTypes } = useModelContext()
  const [rawMode, setRawMode] = useState(false)
  const [rawText, setRawText] = useState('')
  const [rawError, setRawError] = useState(false)

  // Parse value — handle string inputs (e.g., from before type was assigned)
  const resolved = typeof value === 'string'
    ? (() => { try { return JSON.parse(value) } catch { return value } })()
    : value

  const obj =
    typeof resolved === 'object' && resolved !== null && !Array.isArray(resolved)
      ? (resolved as Record<string, unknown>)
      : {}

  // Sync rawText from external value changes while in raw mode
  const valueFingerprint = (() => { try { return JSON.stringify(resolved) } catch { return '' } })()
  useEffect(() => {
    if (!rawMode) return
    setRawText(Object.keys(obj).length > 0 ? JSON.stringify(obj, null, 2) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawMode, valueFingerprint])

  const customType = customTypes.find((ct) => ct.name === typeRef)
  if (!customType) {
    return (
      <span className="text-xs text-muted-foreground italic">
        Unknown type: {typeRef}
      </span>
    )
  }

  const updateField = (fieldName: string, fieldValue: unknown) => {
    const updated = { ...obj, [fieldName]: fieldValue }
    onChange(updated)
  }

  const switchToRaw = () => {
    setRawText(Object.keys(obj).length > 0 ? JSON.stringify(obj, null, 2) : '')
    setRawMode(true)
  }

  const switchToStructured = () => {
    if (rawText.trim()) {
      try {
        const parsed = JSON.parse(rawText)
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          onChange(parsed)
          setRawError(false)
        } else {
          setRawError(true)
          return
        }
      } catch {
        setRawError(true)
        return
      }
    }
    setRawError(false)
    setRawMode(false)
  }

  if (rawMode) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">JSON</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={switchToStructured}
            title="Switch to form view"
          >
            <FormInput className="size-3" />
          </Button>
        </div>
        {rawError && (
          <span className="text-xs text-destructive">Invalid JSON object</span>
        )}
        <textarea
          className={cn(
            'w-full border rounded-md px-2 py-1.5 text-xs font-mono bg-background resize-y',
            compact ? 'min-h-[60px]' : 'min-h-[80px]',
            rawError && 'border-destructive'
          )}
          value={rawText}
          onChange={(e) => {
            setRawText(e.target.value)
            if (rawError) setRawError(false)
          }}
          onBlur={() => {
            if (!rawText.trim()) return
            try {
              const parsed = JSON.parse(rawText)
              if (
                typeof parsed === 'object' &&
                parsed !== null &&
                !Array.isArray(parsed)
              ) {
                onChange(parsed)
                setRawError(false)
              } else {
                setRawError(true)
              }
            } catch {
              setRawError(true)
            }
          }}
        />
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col', compact ? 'gap-1' : 'gap-1.5')}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{typeRef}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={switchToRaw}
          title="Switch to JSON view"
        >
          <Code className="size-3" />
        </Button>
      </div>
      {customType.fields.map((field) => {
        const nestedType = customTypes.find((ct) => ct.name === field.typeRef)

        if (nestedType && _depth < MAX_NESTING_DEPTH) {
          return (
            <div key={field.name} className="flex flex-col gap-1 pl-2 border-l">
              <label className="text-xs text-muted-foreground">
                {field.name}
              </label>
              <StructInput
                value={obj[field.name]}
                onChange={(v) => updateField(field.name, v)}
                typeRef={field.typeRef}
                compact={compact}
                _depth={_depth + 1}
              />
            </div>
          )
        }

        // Custom type at max nesting depth — show a JSON textarea with local state
        if (nestedType) {
          return (
            <NestedJsonField
              key={field.name}
              fieldName={field.name}
              fieldTypeRef={field.typeRef}
              value={obj[field.name]}
              onChange={(v) => updateField(field.name, v)}
            />
          )
        }

        if (field.typeRef === 'boolean') {
          return (
            <label
              key={field.name}
              className="flex items-center gap-1.5 text-xs"
            >
              <input
                type="checkbox"
                checked={!!obj[field.name]}
                onChange={(e) => updateField(field.name, e.target.checked)}
              />
              <span className="text-muted-foreground">{field.name}</span>
            </label>
          )
        }

        return (
          <div key={field.name} className="flex flex-col gap-0.5">
            <label className="text-xs text-muted-foreground">
              {field.name}
            </label>
            <Input
              type={field.typeRef === 'number' ? 'number' : 'text'}
              className={cn(compact ? 'h-6 text-xs px-1.5' : 'h-7 text-sm px-2')}
              value={obj[field.name] !== undefined ? String(obj[field.name]) : ''}
              onChange={(e) => {
                const raw = e.target.value
                const parsed =
                  field.typeRef === 'number' ? coerceNumber(raw) : raw
                updateField(field.name, parsed)
              }}
              placeholder={field.typeRef}
            />
          </div>
        )
      })}
    </div>
  )
}

/** Textarea with local string state for editing a nested struct as JSON at max depth. */
function NestedJsonField({
  fieldName,
  fieldTypeRef,
  value,
  onChange,
}: {
  fieldName: string
  fieldTypeRef: string
  value: unknown
  onChange: (v: unknown) => void
}) {
  const serialize = (v: unknown) =>
    v !== undefined && typeof v === 'object' && v !== null
      ? JSON.stringify(v, null, 2)
      : v !== undefined
        ? String(v)
        : ''

  const [text, setText] = useState(() => serialize(value))
  const [error, setError] = useState(false)

  // Sync from external value changes (e.g., parent reset)
  const fingerprint = (() => { try { return JSON.stringify(value) } catch { return '' } })()
  useEffect(() => {
    setText(serialize(value))
    setError(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint])

  const commit = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) {
      onChange(undefined)
      setError(false)
      return
    }
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        onChange(parsed)
        setError(false)
      } else {
        setError(true)
      }
    } catch {
      setError(true)
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-xs text-muted-foreground">
        {fieldName} <span className="italic">({fieldTypeRef} — JSON)</span>
      </label>
      {error && (
        <span className="text-xs text-destructive">Invalid JSON object</span>
      )}
      <textarea
        className={cn(
          'w-full border rounded-md px-2 py-1.5 text-xs font-mono bg-background resize-y min-h-[40px]',
          error && 'border-destructive'
        )}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (error) setError(false)
        }}
        onBlur={() => commit(text)}
        placeholder={`{ ... } (${fieldTypeRef})`}
      />
    </div>
  )
}
