import type {
  Constant,
  Context,
  DecisionTable,
  Input,
  ModelNode,
  NodeContent,
} from '@/lib/model'
import { ContextInput } from './context'
import { useDiff, useUpdateDiff, useUpdateNode } from '@/context'
import { ConstantInput } from './constant'
import { DecisionTableInput } from './decition-table'
import { InputDefault } from './input-default'

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
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-muted-foreground">
          Content
        </label>
        <ContextInput
          context={node.content}
          updateContext={updateContext}
          diff={contextDiff}
        />
      </div>
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
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-muted-foreground">
          Content
        </label>
        <ConstantInput
          constant={node.content}
          updateConstant={updateConstant}
          diff={constDiff}
        />
      </div>
    )
  }
  if (node.content.type === 'decisionTable') {
    const updateDecisionTable = (decisionTable: NodeContent) => {
      updateNode(node.id, (node) => ({ ...node, content: decisionTable }))
    }

    if (diff !== undefined && diff.content.type === 'decisionTable') {
      const updateDiffTable = (decisionTable: DecisionTable) => {
        updateDiff(node.id, (diff) => ({ ...diff, content: decisionTable }))
      }
      return (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                Original
              </label>
              <div className="opacity-60 pointer-events-none">
                <DecisionTableInput
                  decisionTable={node.content}
                  updateDecisionTable={updateDecisionTable}
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                Proposed Changes
              </label>
              <DecisionTableInput
                decisionTable={diff.content}
                updateDecisionTable={updateDiffTable}
              />
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-muted-foreground">
          Content
        </label>
        <DecisionTableInput
          decisionTable={node.content}
          updateDecisionTable={updateDecisionTable}
        />
      </div>
    )
  }
  if (node.content.type === 'input') {
    const updateInput = (input: NodeContent) => {
      updateNode(node.id, (node) => ({ ...node, content: input }))
    }
    let inputDiff:
      | { new: Input; update: (newValue: Input) => void }
      | undefined = undefined
    if (diff !== undefined && diff.content.type === 'input') {
      inputDiff = {
        new: diff.content,
        update: (newValue) =>
          updateDiff(node.id, (diff) => ({ ...diff, content: newValue })),
      }
    }
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-muted-foreground">
          Default Value
        </label>
        <InputDefault
          input={node.content}
          updateInput={updateInput}
          typeRef={node.typeRef}
          diff={inputDiff}
        />
      </div>
    )
  }

  throw new Error(`Editor not implemented node '${JSON.stringify(node)}'`)
}
