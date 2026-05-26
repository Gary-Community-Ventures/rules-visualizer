import { Input } from '@/components/ui/input'
import type { FieldConfig, SimulationConfig } from '@/lib/api/simulation-api'

const numericTypes = new Set(['Dollar', 'Int', 'Short', 'Byte'])

export function SimulationSettings({
  config,
  setConfig,
}: {
  config: SimulationConfig
  setConfig: (config: SimulationConfig) => void
}) {
  return (
    <div className="space-y-4 text-xs">
      {config.collections.map((collection, collectionIndex) => (
        <div
          key={collection.collectionPath}
          className="flex items-center gap-2"
        >
          <span className="w-48 truncate font-mono font-medium">
            {collection.collectionPath}
          </span>
          <span className="text-muted-foreground">rows</span>
          <NumberInput
            value={collection.minMembers}
            onChange={(value) => {
              const collections = [...config.collections]
              collections[collectionIndex] = {
                ...collection,
                minMembers: value,
              }
              setConfig({ ...config, collections })
            }}
          />
          <span className="text-muted-foreground">to</span>
          <NumberInput
            value={collection.maxMembers}
            onChange={(value) => {
              const collections = [...config.collections]
              collections[collectionIndex] = {
                ...collection,
                maxMembers: value,
              }
              setConfig({ ...config, collections })
            }}
          />
        </div>
      ))}

      <div className="space-y-2">
        {config.scalarFields.map((field, index) => (
          <FieldSettingsRow
            key={field.path}
            field={field}
            onChange={(next) => {
              const fields = [...config.scalarFields]
              fields[index] = next
              setConfig({ ...config, scalarFields: fields })
            }}
          />
        ))}
        {config.collections.map((collection, collectionIndex) =>
          collection.fields.map((field, fieldIndex) => (
            <FieldSettingsRow
              key={`${collection.collectionPath}:${field.path}`}
              field={field}
              prefix={collection.collectionPath}
              onChange={(next) => {
                const collections = [...config.collections]
                const fields = [...collection.fields]
                fields[fieldIndex] = next
                collections[collectionIndex] = { ...collection, fields }
                setConfig({ ...config, collections })
              }}
            />
          ))
        )}
      </div>
    </div>
  )
}

function FieldSettingsRow({
  field,
  onChange,
  prefix,
}: {
  field: FieldConfig
  onChange: (field: FieldConfig) => void
  prefix?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 font-mono">
      <span className="w-48 truncate" title={field.path}>
        {prefix ? `${prefix}: ` : ''}
        {field.path}
      </span>
      <span className="text-muted-foreground">({field.type})</span>
      {numericTypes.has(field.type) && (
        <>
          <NumberInput
            value={field.min ?? 0}
            onChange={(value) => onChange({ ...field, min: value })}
          />
          <span className="text-muted-foreground">to</span>
          <NumberInput
            value={field.max ?? 0}
            onChange={(value) => onChange({ ...field, max: value })}
          />
        </>
      )}
      {field.type === 'Boolean' && (
        <>
          <span className="text-muted-foreground">true %</span>
          <NumberInput
            value={Math.round((field.trueProbability ?? 0.5) * 100)}
            onChange={(value) =>
              onChange({
                ...field,
                trueProbability: Math.max(0, Math.min(100, value)) / 100,
              })
            }
          />
        </>
      )}
      {field.type === 'Day' && (
        <>
          <DateInput
            value={field.minDate ?? currentYearStart()}
            onChange={(value) => onChange({ ...field, minDate: value })}
          />
          <span className="text-muted-foreground">to</span>
          <DateInput
            value={field.maxDate ?? currentYearEnd()}
            onChange={(value) => onChange({ ...field, maxDate: value })}
          />
        </>
      )}
      {(field.type === 'Enum' || field.type === 'MultiEnum') && (
        <span className="text-muted-foreground">
          {field.enumOptions?.length
            ? `${field.enumOptions.length} options`
            : 'no static options'}
        </span>
      )}
      {field.type === 'Rational' && (
        <span className="text-muted-foreground">
          generates simple fractions
        </span>
      )}
      {field.type === 'String' && (
        <span className="text-muted-foreground">generates short text</span>
      )}
    </div>
  )
}

function NumberInput({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}) {
  return (
    <Input
      className="h-7 w-20 text-xs font-mono"
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
    />
  )
}

function DateInput({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Input
      className="h-7 w-36 text-xs font-mono"
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function currentYearStart() {
  return `${new Date().getFullYear()}-01-01`
}

function currentYearEnd() {
  return `${new Date().getFullYear()}-12-31`
}
