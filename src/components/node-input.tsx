import { useMainContext } from '@/context'
import { coerceNumber } from '@/lib/coerce'
import { Input } from './ui/input'
import { StructInput } from './inputs/struct-input'
import type { ModelNode } from '@/lib/model'

export function NodeInput({ node }: { node: ModelNode }) {
  const { inputValues, setInputValues, setResultStale, execution, customTypes } =
    useMainContext()

  const value = inputValues[node.id]

  const commit = () => {
    setResultStale(true)
    execution.debouncedExecute()
  }

  // Prevent clicks on inputs from bubbling up and opening the editor panel
  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation()

  if (node.typeRef && customTypes.some((ct) => ct.name === node.typeRef)) {
    return (
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions
      <div className="mt-1" onClick={stopPropagation}>
        <StructInput
          compact
          value={value}
          onChange={(v) => {
            setInputValues((prev) => ({ ...prev, [node.id]: v }))
            commit()
          }}
          typeRef={node.typeRef}
        />
      </div>
    )
  }

  if (node.typeRef === 'boolean') {
    return (
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-noninteractive-element-interactions
      <label
        className="flex items-center gap-1.5 mt-1 text-xs"
        onClick={stopPropagation}
      >
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => {
            setInputValues((prev) => ({
              ...prev,
              [node.id]: e.target.checked,
            }))
            commit()
          }}
        />
        {value ? 'true' : 'false'}
      </label>
    )
  }

  return (
    <Input
      type={node.typeRef === 'number' ? 'number' : 'text'}
      className="mt-1 h-7 text-xs px-2"
      value={value !== undefined ? String(value) : ''}
      onClick={stopPropagation}
      onChange={(e) => {
        const raw = e.target.value
        const parsed = node.typeRef === 'number' ? coerceNumber(raw) : raw
        setInputValues((prev) => ({ ...prev, [node.id]: parsed }))
        commit()
      }}
      placeholder={node.typeRef ?? 'value'}
    />
  )
}
