import { useMainContext } from '@/context'
import { Node } from '@/components/node'

export function HomePage() {
  const { nodes } = useMainContext()

  return (
    <div>
      {Object.keys(nodes).map((id) => (
        <Node id={id} key={id} />
      ))}
    </div>
  )
}
