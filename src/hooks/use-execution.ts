import { useCallback, useRef } from 'react'
import { useMainContext } from '@/context'
import { createKieEngine } from '@/lib/engine'

function getKieBaseUrl(): string {
  const stored = localStorage.getItem('kie-server-url')
  if (stored) return stored
  // In dev, use Vite proxy; in prod, use full URL
  if (import.meta.env.DEV) return ''
  return 'http://localhost:8080'
}

export function useExecution() {
  const {
    model,
    inputValues,
    setExecutionResult,
    setIsExecuting,
    setLastRunTimestamp,
    setResultStale,
    setLastError,
    isExecuting,
  } = useMainContext()

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const execute = useCallback(async () => {
    setIsExecuting(true)
    setLastError(null)
    try {
      const baseUrl = getKieBaseUrl()
      const engine = createKieEngine(baseUrl)
      const result = await engine.execute(model, inputValues)
      setExecutionResult(result)
      setLastRunTimestamp(Date.now())
      setResultStale(false)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown execution error'
      setLastError(message)
      console.error('Execution failed:', err)
    } finally {
      setIsExecuting(false)
    }
  }, [
    model,
    inputValues,
    setExecutionResult,
    setIsExecuting,
    setLastRunTimestamp,
    setResultStale,
    setLastError,
  ])

  const debouncedExecute = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }
    debounceRef.current = setTimeout(() => {
      execute()
    }, 500)
  }, [execute])

  return { execute, debouncedExecute, isExecuting }
}
