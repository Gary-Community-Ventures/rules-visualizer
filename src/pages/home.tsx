import { useMainContext } from '@/context'
import { Node } from '@/components/node'

export function HomePage() {
  const { nodes } = useMainContext()

  const rows = [
    ['a', 'b', 'c'],
  ]

  return (
    <div>
      {Object.keys(nodes).map((id) => (
        <Node id={id} key={id} />
      ))}
    </div>
  )
}
