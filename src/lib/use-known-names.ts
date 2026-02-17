import { useMemo } from 'react'
import { useMainContext } from '@/context'

export function useKnownNames(additionalNames: string[] = []): string[] {
  const { model } = useMainContext()
  // Join to create a stable dependency key
  const additionalKey = additionalNames.join('\0')

  return useMemo(
    () => [
      ...Object.values(model.nodes).map((n) => n.name),
      ...additionalKey.split('\0').filter(Boolean),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model.nodes, additionalKey]
  )
}
