import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import {
  useMainContext,
  useDiff,
  useUpdateDiff,
  useUpdateNode,
} from '@/context'
import { ConstantInput } from '@/components/inputs/constant'
import { Button } from '@/components/ui/button'
import type { Constant, ModelNode } from '@/lib/model'

function ConstantRow({ node }: { node: ModelNode }) {
  const updateNode = useUpdateNode()
  const diff = useDiff(node.id)
  const updateDiff = useUpdateDiff()

  if (node.content.type !== 'constant') return null

  const updateConstant = (constant: Constant) => {
    updateNode(node.id, (n) => ({ ...n, content: constant }))
  }

  let constDiff:
    | { new: Constant; update: (newValue: Constant) => void }
    | undefined = undefined
  if (diff !== undefined && diff.content.type === 'constant') {
    constDiff = {
      new: diff.content,
      update: (newValue) =>
        updateDiff(node.id, (d) => ({ ...d, content: newValue })),
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <label className="mb-2 block text-sm font-medium">{node.name}</label>
      <ConstantInput
        constant={node.content}
        updateConstant={updateConstant}
        diff={constDiff}
      />
    </div>
  )
}

export function ConstantsPage() {
  const { model } = useMainContext()

  const constantNodes = Object.values(model.nodes).filter(
    (node) => node.content.type === 'constant'
  )

  return (
    <div className="flex flex-col h-screen">
      <div className="border-b flex items-center gap-3 p-2 bg-background">
        <Button variant="outline" size="icon" asChild>
          <Link to="/">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <h1 className="text-sm font-semibold">Constants</h1>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {constantNodes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No constant nodes in this model.
          </p>
        ) : (
          <div className="flex flex-col gap-4 max-w-2xl">
            {constantNodes.map((node) => (
              <ConstantRow key={node.id} node={node} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
