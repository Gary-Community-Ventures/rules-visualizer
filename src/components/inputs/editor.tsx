import type { ModelNode, NodeContent } from '@/lib/model'
import { ContextInput } from './context'
import { useUpdateNode } from '@/context'
import { ConstantInput } from './constant'
import { DecisionTableInput } from './decition-table'

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
  if (node.content.type === 'constant') {
    const updateConstant = (constant: NodeContent) => {
      updateNode(node.id, (node) => ({ ...node, content: constant }))
    }
    return (
      <ConstantInput constant={node.content} updateConstant={updateConstant} />
    )
  }
  if (node.content.type === 'decisionTable') {
    const updateDecisionTable = (decisionTable: NodeContent) => {
      updateNode(node.id, (node) => ({ ...node, content: decisionTable }))
    }
    return (
      <DecisionTableInput
        decisionTable={node.content}
        updateDecisionTable={updateDecisionTable}
      />
    )
  }
  if (node.content.type === 'input') {
    return null
  }

  throw new Error(`Editor not implemented node '${JSON.stringify(node)}'`)
}
