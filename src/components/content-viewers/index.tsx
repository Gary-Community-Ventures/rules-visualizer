import type { NodeContent } from '@/lib/model'
import { RacVariableViewer } from './rac-variable-viewer'
import { RacEntityViewer } from './rac-entity-viewer'
import { FactGraphWritableViewer } from './fact-graph-writable-viewer'
import { FactGraphDerivedViewer } from './fact-graph-derived-viewer'

type Props = {
  content: NodeContent
}

export function ContentViewer({ content }: Props) {
  switch (content.format) {
    case 'rac':
      switch (content.type) {
        case 'variable':
          return <RacVariableViewer content={content} />
        case 'entity':
          return <RacEntityViewer content={content} />
      }
      break
    case 'factGraph':
      switch (content.type) {
        case 'writable':
          return <FactGraphWritableViewer content={content} />
        case 'derived':
          return <FactGraphDerivedViewer content={content} />
      }
      break
  }
}
