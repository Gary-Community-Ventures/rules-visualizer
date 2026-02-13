import { useState } from 'react'
import { useNodeResult, useMainContext } from '@/context'
import { CircleAlert, CircleMinus } from 'lucide-react'

export function NodeResultBadge({ nodeId }: { nodeId: string }) {
  const nodeResult = useNodeResult(nodeId)
  const { resultStale } = useMainContext()
  const [expanded, setExpanded] = useState(false)

  if (!nodeResult) return null

  const staleClass = resultStale ? 'opacity-50' : ''

  if (nodeResult.status === 'SUCCEEDED') {
    const display = formatResult(nodeResult.result)
    return (
      <div
        className={`mt-1 inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-800 px-2 py-0.5 text-xs font-medium ${staleClass}`}
        title={safeStringify(nodeResult.result)}
      >
        {display}
      </div>
    )
  }

  if (nodeResult.status === 'FAILED') {
    const errorText =
      nodeResult.messages.length > 0
        ? nodeResult.messages.join('\n')
        : 'Unknown error'
    return (
      <div className={`mt-1 flex flex-col items-center ${staleClass}`}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-800 px-2 py-0.5 text-xs font-medium hover:bg-red-200 transition-colors"
        >
          <CircleAlert className="size-3" />
          Error
        </button>
        {expanded && (
          <div className="mt-1 max-w-xs rounded bg-red-50 border border-red-200 p-2 text-xs text-red-700 whitespace-pre-wrap break-words">
            {errorText}
          </div>
        )}
      </div>
    )
  }

  // SKIPPED or NOT_EVALUATED
  return (
    <div
      className={`mt-1 inline-flex items-center gap-1 rounded-full bg-gray-100 text-gray-500 px-2 py-0.5 text-xs font-medium ${staleClass}`}
    >
      <CircleMinus className="size-3" />
      {nodeResult.status === 'SKIPPED' ? 'Skipped' : 'Not evaluated'}
    </div>
  )
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function formatResult(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  const str = typeof value === 'object' ? safeStringify(value) : String(value)
  return str.length > 30 ? str.slice(0, 27) + '...' : str
}
