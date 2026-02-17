import type { Constant, Context, ModelNode, NodeContent } from '@/lib/model'
import { ContextInput } from './context'
import { useDiff, useUpdateDiff, useUpdateNode } from '@/context'
import { ConstantInput } from './constant'
import { DecisionTableInput } from './decition-table'

type EditorProps = {
  node: ModelNode
}

export function Editor({ node }: EditorProps) {
  const updateNode = useUpdateNode()
  const diff = useDiff(node.id)
  const updateDiff = useUpdateDiff()

  if (diff !== undefined && diff.content.type !== node.content.type) {
    throw new Error('nodes cannot change type (yet)')
  }

  if (node.content.type === 'context') {
    const updateContext = (context: NodeContent) => {
      updateNode(node.id, (node) => ({ ...node, content: context }))
    }
    let contextDiff:
      | { new: Context; update: (newValue: Context) => void }
      | undefined = undefined
    if (diff !== undefined && diff.content.type === 'context') {
      contextDiff = {
        new: diff.content,
        update: (newValue) =>
          updateDiff(node.id, (diff) => ({ ...diff, content: newValue })),
      }
    }

    return (
      <ContextInput
        context={node.content}
        updateContext={updateContext}
        diff={contextDiff}
      />
    )
  }
  if (node.content.type === 'constant') {
    const updateConstant = (constant: NodeContent) => {
      updateNode(node.id, (node) => ({ ...node, content: constant }))
    }
    let constDiff:
      | { new: Constant; update: (newValue: Constant) => void }
      | undefined = undefined
    if (diff !== undefined && diff.content.type === 'constant') {
      constDiff = {
        new: diff.content,
        update: (newValue) =>
          updateDiff(node.id, (diff) => ({ ...diff, content: newValue })),
      }
    }
    return (
      <ConstantInput
        constant={node.content}
        updateConstant={updateConstant}
        diff={constDiff}
      />
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
