import { useMainContext } from '@/context'
import { Node } from '@/components/node'

export function HomePage() {
  const { model } = useMainContext()

  return (
    <div>
      {Object.keys(model.elements).map((id) => (
        <Node id={id} key={id} />
      ))}
    </div>
  )
}
