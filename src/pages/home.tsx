import { useMainContext } from '@/context'
import { Rows } from '@/components/node'
import { Arrows } from '@/components/arrows'
import { ToolBar } from '@/components/tool-bar'
import { nodeRows } from '@/lib/nodes'

export function HomePage() {
  const { nodes } = useMainContext()

  const rows: string[][] = nodeRows(nodes)

  return (
    <div className="flex flex-col gap-5">
      <ToolBar />
      <Rows rows={rows} />
      <Arrows rows={rows} />
    </div>
  )
}
