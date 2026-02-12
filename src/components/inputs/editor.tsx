import type { ModelNode, NodeContent } from '@/lib/model'
import { ContextInput } from './context'
import { useUpdateNode } from '@/context'

type EditorProps = {
  node: ModelNode
}
export function Editor({ node }: EditorProps) {
  const updateNode = useUpdateNode()

  if (node.content.type === 'context') {
    const updateContext = (context: NodeContent) => {
      updateNode(node.id, (node) => ({ ...node, content: context }))
    }

    return <ContextInput context={node.content} updateContext={updateContext} />
  }

  return <div>Not implemented</div>
}
