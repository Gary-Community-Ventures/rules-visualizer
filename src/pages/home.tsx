import { useMainContext } from '@/context'
import { Rows } from '@/components/node'
import { Arrows } from '@/components/arrows'
import { ToolBar } from '@/components/tool-bar'
import { PanContainer } from '@/components/pan-container'
import { nodeRows } from '@/lib/graph'

export function HomePage() {
  const { model, selectedNodes, showChildren } = useMainContext()

  const rows: string[][] = nodeRows(model.nodes, showChildren, selectedNodes)

  return (
    <div className="flex flex-col h-screen">
      <ToolBar />
      <PanContainer>
        <Rows rows={rows} />
      </PanContainer>
      <Arrows rows={rows} />
    </div>
  )
}
