import { useMemo } from 'react'
import { FEEL_DATA_TYPES } from '@/lib/model'
import { useModelContext } from '@/context'
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxGroup,
  ComboboxLabel,
  ComboboxSeparator,
  ComboboxEmpty,
} from '@/components/ui/combobox'

type TypeSelectorProps = {
  value: string | undefined
  onChange: (value: string | undefined) => void
  placeholder?: string
  className?: string
}

export function TypeSelector({
  value,
  onChange,
  placeholder = 'Type...',
  className,
}: TypeSelectorProps) {
  const { customTypes } = useModelContext()

  const allOptions = useMemo(() => {
    const builtIn = FEEL_DATA_TYPES.map((t) => ({ value: t, label: t }))
    const custom = customTypes.map((t) => ({ value: t.name, label: t.name }))
    return { builtIn, custom }
  }, [customTypes])

  return (
    <Combobox
      value={value ?? null}
      onValueChange={(val) => onChange(val ?? undefined)}
    >
      <ComboboxInput
        placeholder={placeholder}
        className={className}
        showClear={!!value}
      />
      <ComboboxContent>
        <ComboboxList>
          <ComboboxEmpty>No types found</ComboboxEmpty>
          <ComboboxGroup>
            <ComboboxLabel>Built-in</ComboboxLabel>
            {allOptions.builtIn.map((opt) => (
              <ComboboxItem key={opt.value} value={opt.value}>
                {opt.label}
              </ComboboxItem>
            ))}
          </ComboboxGroup>
          {allOptions.custom.length > 0 && (
            <>
              <ComboboxSeparator />
              <ComboboxGroup>
                <ComboboxLabel>Custom</ComboboxLabel>
                {allOptions.custom.map((opt) => (
                  <ComboboxItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </ComboboxItem>
                ))}
              </ComboboxGroup>
            </>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
