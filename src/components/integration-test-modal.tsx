import { useEffect, useRef, useState } from 'react'
import { useMainContext, useUpdateIntegrationTests } from '@/context'
import { createIntegrationTestCase } from '@/lib/model'
import type { IntegrationTestCase } from '@/lib/model'
import {
  executeIntegrationTest,
  type IntegrationTestResult,
} from '@/lib/engine/test-runner'
import { getLeafNodes } from '@/lib/graph'
import { ParsedInput } from './inputs/parsed-input'
import { Button } from './ui/button'
import { Input } from './ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import { Play, Trash2, Copy, Plus, Check, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type RunState = Record<string, IntegrationTestResult | 'running'>

export function IntegrationTestModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { model, inputValues, executionResult } = useMainContext()
  const updateTests = useUpdateIntegrationTests()
  const [runState, setRunState] = useState<RunState>({})
  const abortRef = useRef<AbortController | null>(null)

  // Abort in-flight tests on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  const tests = model.integrationTests ?? []

  const inputNodes = Object.values(model.nodes).filter(
    (n) => n.content.type === 'input'
  )
  const assertableNodes = Object.values(model.nodes).filter(
    (n) => n.content.type !== 'input' && n.content.type !== 'constant'
  )

  const addTest = () => {
    updateTests((prev) => [...prev, createIntegrationTestCase()])
  }

  const createFromLastRun = () => {
    if (!executionResult) return

    const inputs: Record<string, unknown> = {}
    for (const node of inputNodes) {
      if (inputValues[node.id] !== undefined && inputValues[node.id] !== '') {
        inputs[node.id] = inputValues[node.id]
      }
    }

    const assertions: Record<string, string> = {}
    const leafIds = getLeafNodes(model.nodes)
    for (const nodeId of leafIds) {
      const nodeResult = executionResult.nodeResults[nodeId]
      if (!nodeResult) continue
      const val =
        typeof nodeResult.result === 'object' && nodeResult.result !== null
          ? JSON.stringify(nodeResult.result)
          : String(nodeResult.result ?? '')
      assertions[nodeId] = val
    }

    const existingCount = tests.length
    updateTests((prev) => [
      ...prev,
      createIntegrationTestCase({
        name: `Test ${existingCount + 1}`,
        inputs,
        assertions,
      }),
    ])
  }

  const runTest = async (testCase: IntegrationTestCase) => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setRunState((s) => ({ ...s, [testCase.id]: 'running' }))
    try {
      const result = await executeIntegrationTest(
        testCase,
        model,
        controller.signal
      )
      if (controller.signal.aborted) return
      setRunState((s) => ({ ...s, [testCase.id]: result }))
    } catch (err) {
      if (controller.signal.aborted) return
      // Surface the error as a failed assertion so the user sees what went wrong
      const message = err instanceof Error ? err.message : 'Unknown error'
      setRunState((s) => ({
        ...s,
        [testCase.id]: {
          passed: false,
          assertionResults: {
            _error: {
              passed: false,
              actual: message,
              status: 'NOT_EVALUATED',
              messages: [message],
            },
          },
        } satisfies IntegrationTestResult,
      }))
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Integration Tests</DialogTitle>
          <DialogDescription>
            Test the full model end-to-end with real inputs and assertions on
            selected node outputs.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 overflow-y-auto flex-1 min-h-0">
          {tests.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No integration tests yet.
            </p>
          )}
          {tests.map((testCase) => (
            <IntegrationTestCard
              key={testCase.id}
              testCase={testCase}
              inputNodes={inputNodes}
              assertableNodes={assertableNodes}
              runState={runState}
              executionResult={executionResult}
              onRun={() => runTest(testCase)}
              onUpdate={updateTests}
              onDelete={() =>
                updateTests((prev) => prev.filter((t) => t.id !== testCase.id))
              }
              onDuplicate={() =>
                updateTests((prev) => {
                  const idx = prev.findIndex((t) => t.id === testCase.id)
                  const dupe = createIntegrationTestCase({
                    name: testCase.name ? `${testCase.name} (copy)` : '',
                    inputs: { ...testCase.inputs },
                    assertions: { ...testCase.assertions },
                  })
                  const next = [...prev]
                  next.splice(idx + 1, 0, dupe)
                  return next
                })
              }
            />
          ))}
        </div>
        <div className="flex gap-2 pt-2 border-t">
          <Button variant="outline" size="sm" onClick={addTest}>
            <Plus className="size-3.5 mr-1" />
            Add Test
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={createFromLastRun}
            disabled={!executionResult}
          >
            <Plus className="size-3.5 mr-1" />
            Create from Last Run
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Single integration test card ──────────────────────────────────────

function IntegrationTestCard({
  testCase,
  inputNodes,
  assertableNodes,
  runState,
  executionResult,
  onRun,
  onUpdate,
  onDelete,
  onDuplicate,
}: {
  testCase: IntegrationTestCase
  inputNodes: { id: string; name: string; typeRef?: string }[]
  assertableNodes: { id: string; name: string }[]
  runState: RunState
  executionResult: { nodeResults: Record<string, { result: unknown }> } | null
  onRun: () => void
  onUpdate: (
    updater: (tests: IntegrationTestCase[]) => IntegrationTestCase[]
  ) => void
  onDelete: () => void
  onDuplicate: () => void
}) {
  const result = runState[testCase.id]
  const isRunning = result === 'running'
  const testResult = result && result !== 'running' ? result : null

  const assertedNodeIds = new Set(Object.keys(testCase.assertions))
  const availableForAssertion = assertableNodes.filter(
    (n) => !assertedNodeIds.has(n.id)
  )

  const addAssertion = (nodeId: string) => {
    let prefill = ''
    if (executionResult) {
      const nr = executionResult.nodeResults[nodeId]
      if (nr) {
        prefill =
          typeof nr.result === 'object' && nr.result !== null
            ? JSON.stringify(nr.result)
            : String(nr.result ?? '')
      }
    }
    onUpdate((prev) =>
      prev.map((t) =>
        t.id === testCase.id
          ? { ...t, assertions: { ...t.assertions, [nodeId]: prefill } }
          : t
      )
    )
  }

  const removeAssertion = (nodeId: string) => {
    onUpdate((prev) =>
      prev.map((t) => {
        if (t.id !== testCase.id) return t
        const { [nodeId]: _, ...rest } = t.assertions
        return { ...t, assertions: rest }
      })
    )
  }

  return (
    <div
      className={cn(
        'border rounded-md p-3 flex flex-col gap-2',
        testResult?.passed === true && 'border-emerald-300 bg-emerald-50/50',
        testResult?.passed === false && 'border-red-300 bg-red-50/50'
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Test name"
          value={testCase.name}
          onChange={(e) =>
            onUpdate((prev) =>
              prev.map((t) =>
                t.id === testCase.id ? { ...t, name: e.target.value } : t
              )
            )
          }
          className="h-7 text-sm flex-1"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onRun}
          disabled={isRunning}
        >
          {isRunning ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground"
          onClick={onDuplicate}
        >
          <Copy className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-red-600"
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {/* Inputs */}
      {inputNodes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground font-medium">
            Inputs
          </span>
          {inputNodes.map((node) => (
            <div key={node.id} className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground w-32 shrink-0 truncate">
                {node.name}
              </label>
              <ParsedInput
                placeholder="value"
                value={testCase.inputs[node.id]}
                onChange={(parsed) =>
                  onUpdate((prev) =>
                    prev.map((t) =>
                      t.id === testCase.id
                        ? {
                            ...t,
                            inputs: {
                              ...t.inputs,
                              [node.id]: parsed,
                            },
                          }
                        : t
                    )
                  )
                }
                className="h-7 text-sm"
              />
            </div>
          ))}
        </div>
      )}

      {/* Assertions */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground font-medium">
          Assertions
        </span>
        {Object.entries(testCase.assertions).map(([nodeId, expected]) => {
          const node = assertableNodes.find((n) => n.id === nodeId)
          const assertionResult = testResult?.assertionResults[nodeId]
          return (
            <div key={nodeId} className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground w-32 shrink-0 truncate">
                {node?.name ?? nodeId}
              </label>
              <Input
                placeholder="expected value"
                value={expected}
                onChange={(e) =>
                  onUpdate((prev) =>
                    prev.map((t) =>
                      t.id === testCase.id
                        ? {
                            ...t,
                            assertions: {
                              ...t.assertions,
                              [nodeId]: e.target.value,
                            },
                          }
                        : t
                    )
                  )
                }
                className="h-7 text-sm flex-1"
              />
              {assertionResult && (
                <>
                  {assertionResult.passed ? (
                    <Check className="size-3.5 text-emerald-600 shrink-0" />
                  ) : (
                    <span className="text-xs text-red-500 shrink-0 truncate max-w-24">
                      got: {assertionResult.actual || '(empty)'}
                    </span>
                  )}
                </>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-red-600"
                onClick={() => removeAssertion(nodeId)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          )
        })}
        {availableForAssertion.length > 0 && (
          <select
            className="h-7 text-xs border rounded px-2 text-muted-foreground w-fit"
            value=""
            onChange={(e) => {
              if (e.target.value) addAssertion(e.target.value)
            }}
          >
            <option value="">+ Add assertion...</option>
            {availableForAssertion.map((node) => (
              <option key={node.id} value={node.id}>
                {node.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Result summary */}
      {testResult && (
        <div className="flex items-center gap-2 text-xs">
          {testResult.passed ? (
            <Check className="size-3.5 text-emerald-600" />
          ) : (
            <X className="size-3.5 text-red-600" />
          )}
          <span
            className={cn(
              testResult.passed ? 'text-emerald-700' : 'text-red-700'
            )}
          >
            {testResult.passed ? 'Passed' : 'Failed'}
          </span>
        </div>
      )}
    </div>
  )
}
