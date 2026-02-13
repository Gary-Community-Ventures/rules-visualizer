import { useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { useMainContext } from '@/context'
import { useExecution } from '@/hooks/use-execution'
import { Button } from './ui/button'
import { Input } from './ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogDescription,
} from './ui/dialog'

export function InputModal() {
  const { model, inputValues, setInputValues } = useMainContext()
  const { execute, isExecuting } = useExecution()
  const [open, setOpen] = useState(false)

  const inputNodes = Object.values(model.nodes).filter(
    (n) => n.content.type === 'input'
  )

  const handleChange = (name: string, value: unknown, typeRef?: string) => {
    setInputValues((prev) => ({
      ...prev,
      [name]: typeRef === 'number' ? coerceNumber(value) : value,
    }))
  }

  const handleExecute = async () => {
    await execute()
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <ClipboardList className="size-4" />
          Inputs
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Model Inputs</DialogTitle>
          <DialogDescription>
            Set input values and execute the model.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {inputNodes.map((node) => (
            <div key={node.id} className="flex flex-col gap-1">
              <label className="text-sm font-medium">{node.name}</label>
              {node.typeRef === 'boolean' ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!inputValues[node.name]}
                    onChange={(e) =>
                      handleChange(node.name, e.target.checked, node.typeRef)
                    }
                  />
                  {inputValues[node.name] ? 'true' : 'false'}
                </label>
              ) : (
                <Input
                  type={node.typeRef === 'number' ? 'number' : 'text'}
                  value={
                    inputValues[node.name] !== undefined
                      ? String(inputValues[node.name])
                      : ''
                  }
                  onChange={(e) =>
                    handleChange(node.name, e.target.value, node.typeRef)
                  }
                  placeholder={node.typeRef ?? 'string'}
                />
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={handleExecute} disabled={isExecuting}>
            {isExecuting ? 'Executing...' : 'Execute'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function coerceNumber(value: unknown): number | string {
  if (typeof value === 'number') return value
  const str = String(value)
  if (str === '') return ''
  const num = Number(str)
  return Number.isNaN(num) ? str : num
}
