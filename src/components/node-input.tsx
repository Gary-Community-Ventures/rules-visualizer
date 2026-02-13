import { useMainContext, useNode } from '@/context'
import { coerceNumber } from '@/lib/coerce'
import { Input } from './ui/input'

export function NodeInput({ nodeId }: { nodeId: string }) {
  const node = useNode(nodeId)
  const { inputValues, setInputValues, setResultStale, execution } =
    useMainContext()

  const value = inputValues[nodeId]

  const commit = () => {
    setResultStale(true)
    execution.debouncedExecute()
  }

  if (node.typeRef === 'boolean') {
    return (
      <label className="flex items-center gap-1.5 mt-1 text-xs">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => {
            setInputValues((prev) => ({
              ...prev,
              [nodeId]: e.target.checked,
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
      onChange={(e) => {
        const raw = e.target.value
        const parsed = node.typeRef === 'number' ? coerceNumber(raw) : raw
        setInputValues((prev) => ({ ...prev, [nodeId]: parsed }))
        commit()
      }}
      placeholder={node.typeRef ?? 'value'}
    />
  )
}
