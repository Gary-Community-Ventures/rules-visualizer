import { useMemo } from 'react'
import { useMainContext } from '@/context'

export function useKnownNames(additionalNames: string[] = []): string[] {
  const { model, diffs } = useMainContext()
  // Join to create a stable dependency key
  const additionalKey = additionalNames.join('\0')

  return useMemo(() => {
    const names = new Set<string>()

    // Add model node names
    for (const node of Object.values(model.nodes)) {
      names.add(node.name)
    }

    // Add new diff node names (nodes not in model)
    for (const diff of diffs) {
      if (!(diff.id in model.nodes)) {
        names.add(diff.name)
      }
    }

    // Add additional names
    for (const name of additionalKey.split('\0').filter(Boolean)) {
      names.add(name)
    }

    return [...names]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.nodes, diffs, additionalKey])
}
