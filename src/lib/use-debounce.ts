import { useCallback, useRef } from 'react'

export function useDebounce(delay: number): (callback: () => void) => void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  return useCallback(
    (callback: () => void) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(callback, delay)
    },
    [delay]
  )
}
