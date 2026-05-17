import { useState, useEffect } from 'react'

export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key)
    if (stored === null) return initialValue
    // Tolerate junk left behind by an earlier bug (e.g. the literal
    // string "undefined" from a misplaced JSON.stringify(undefined)).
    // Fall back to the seed and let the useEffect below rewrite the
    // entry with a valid value.
    try {
      return JSON.parse(stored) as T
    } catch {
      return initialValue
    }
  })

  useEffect(() => {
    if (value === undefined) {
      localStorage.removeItem(key)
      return
    }
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // ignore quota / private-mode errors
    }
  }, [key, value])

  return [value, setValue]
}
