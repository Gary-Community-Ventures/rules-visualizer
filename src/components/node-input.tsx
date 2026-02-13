import { useMainContext, useNode } from '@/context'
import { useExecution } from '@/hooks/use-execution'
import { Input } from './ui/input'

export function NodeInput({ nodeId }: { nodeId: string }) {
  const node = useNode(nodeId)
  const { inputValues, setInputValues, setResultStale } = useMainContext()
  const { debouncedExecute } = useExecution()

  const value = inputValues[node.name]

  const commit = () => {
    setResultStale(true)
    debouncedExecute()
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
              [node.name]: e.target.checked,
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
        const parsed =
          node.typeRef === 'number' && raw !== ''
            ? Number.isNaN(Number(raw))
              ? raw
              : Number(raw)
            : raw
        setInputValues((prev) => ({ ...prev, [node.name]: parsed }))
        commit()
      }}
      placeholder={node.typeRef ?? 'value'}
    />
  )
}
