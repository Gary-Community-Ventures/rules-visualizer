import { useMainContext } from '@/context'
import { Rows } from '@/components/node'
import { Arrows } from '@/components/arrows'
import { ToolBar } from '@/components/tool-bar'
import { PanContainer } from '@/components/pan-container'
import { nodeRows } from '@/lib/nodes'

export function HomePage() {
  const { nodes, selectedNodes } = useMainContext()

  const rows: string[][] = nodeRows(nodes, selectedNodes)

  return (
    <div className="flex flex-col h-screen">
      <ToolBar />
      <PanContainer>
        <Arrows rows={rows} />
        <Rows rows={rows} />
      </PanContainer>
    </div>
  )
}
