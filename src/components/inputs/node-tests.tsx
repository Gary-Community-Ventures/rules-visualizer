import { useState } from 'react'
import type { ModelNode, ModelNodes, NodeTestCase } from '@/lib/model'
import { createTestCase } from '@/lib/model'
import { useUpdateNode, useUpdateDiff } from '@/context'
import { executeNodeTest } from '@/lib/engine/test-runner'
import { useMainContext } from '@/context'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import {
  Plus,
  Play,
  Trash2,
  Copy,
  Check,
  X,
  Loader2,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type TestResult = {
  passed: boolean
  actual: string
  status: string
  messages: string[]
}

type TestRunState = Record<string, TestResult | 'running'>

type NodeTestsProps = {
  node: ModelNode
  allNodes: ModelNodes
  diff?: ModelNode
}

export function NodeTests({ node, allNodes, diff }: NodeTestsProps) {
  const updateNode = useUpdateNode()
  const updateDiff = useUpdateDiff()
  const { model } = useMainContext()
  const [runState, setRunState] = useState<TestRunState>({})

  const hasDiff = diff !== undefined

  const tests = node.tests ?? []
  const diffTests = diff?.tests ?? []

  // Only show input fields for non-constant dependencies (constants are
  // included in the mini model as-is and don't need user-provided values)
  const depNodes = node.dependencies
    .map((depId) => allNodes[depId])
    .filter((dep) => dep && dep.content.type !== 'constant')

  const updateTests = (updater: (tests: NodeTestCase[]) => NodeTestCase[]) => {
    updateNode(node.id, (n) => ({
      ...n,
      tests: updater(n.tests ?? []),
    }))
  }

  const updateDiffTests = (
    updater: (tests: NodeTestCase[]) => NodeTestCase[]
  ) => {
    updateDiff(node.id, (d) => ({
      ...d,
      tests: updater(d.tests ?? []),
    }))
  }

  const addTest = () => {
    if (hasDiff) {
      updateDiffTests((prev) => [...prev, createTestCase()])
    } else {
      updateTests((prev) => [...prev, createTestCase()])
    }
  }

  // Expand by default when there's a diff
  const [collapsed, setCollapsed] = useState(!hasDiff)
  const [isRunningAll, setIsRunningAll] = useState(false)

  const runAllTests = async (cases: NodeTestCase[]) => {
    if (cases.length === 0) return
    setIsRunningAll(true)
    for (const tc of cases) {
      setRunState((s) => ({ ...s, [tc.id]: 'running' }))
    }
    for (const tc of cases) {
      try {
        const result = await executeNodeTest(node.id, tc, model)
        setRunState((s) => ({ ...s, [tc.id]: result }))
      } catch (err) {
        setRunState((s) => ({
          ...s,
          [tc.id]: {
            passed: false,
            actual: '',
            status: 'FAILED',
            messages: [err instanceof Error ? err.message : 'Unknown error'],
          },
        }))
      }
    }
    setIsRunningAll(false)
  }

  const runTest = async (testCase: NodeTestCase) => {
    setRunState((s) => ({ ...s, [testCase.id]: 'running' }))
    try {
      const result = await executeNodeTest(node.id, testCase, model)
      setRunState((s) => ({ ...s, [testCase.id]: result }))
    } catch (err) {
      setRunState((s) => ({
        ...s,
        [testCase.id]: {
          passed: false,
          actual: '',
          status: 'FAILED',
          messages: [err instanceof Error ? err.message : 'Unknown error'],
        },
      }))
    }
  }

  // ─── Diff merging: pair old/new tests by ID ──────────────────────
  const mergedTests = hasDiff ? mergeTests(tests, diffTests) : null
  const activeCases = hasDiff ? diffTests : tests

  // ─── Summary counts ──────────────────────────────────────────────
  const passCount = activeCases.filter((t) => {
    const r = runState[t.id]
    return r && r !== 'running' && r.passed
  }).length
  const failCount = activeCases.filter((t) => {
    const r = runState[t.id]
    return r && r !== 'running' && !r.passed
  }).length
  const hasResults = passCount + failCount > 0

  const header = (
    <div className="flex items-center gap-2">
      <button
        className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setCollapsed((c) => !c)}
      >
        <ChevronRight
          className={cn(
            'size-3.5 transition-transform',
            !collapsed && 'rotate-90'
          )}
        />
        Tests ({activeCases.length})
      </button>
      {hasResults && (
        <span className="text-xs text-muted-foreground">
          {passCount > 0 && (
            <span className="text-emerald-600">{passCount} passed</span>
          )}
          {passCount > 0 && failCount > 0 && ', '}
          {failCount > 0 && (
            <span className="text-red-600">{failCount} failed</span>
          )}
        </span>
      )}
    </div>
  )

  // ─── Render: diff mode ────────────────────────────────────────────
  if (hasDiff && mergedTests) {
    return (
      <div className="flex flex-col gap-2">
        {header}
        {!collapsed && (
          <>
            {mergedTests.map((mt) => (
              <DiffTestCard
                key={mt.old?.id ?? mt.new!.id}
                old={mt.old}
                new_={mt.new}
                depNodes={depNodes}
                runState={runState}
                onRun={mt.new ? () => runTest(mt.new!) : undefined}
                onUpdate={(updater) => updateDiffTests(updater)}
                onDelete={
                  mt.new
                    ? () =>
                        updateDiffTests((prev) =>
                          prev.filter((t) => t.id !== mt.new!.id)
                        )
                    : undefined
                }
                onDuplicate={
                  mt.new
                    ? () =>
                        updateDiffTests((prev) => {
                          const idx = prev.findIndex((t) => t.id === mt.new!.id)
                          const dupe = createTestCase({
                            name: mt.new!.name ? `${mt.new!.name} (copy)` : '',
                            inputs: { ...mt.new!.inputs },
                            expected: mt.new!.expected,
                          })
                          const next = [...prev]
                          next.splice(idx + 1, 0, dupe)
                          return next
                        })
                    : undefined
                }
              />
            ))}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={addTest}>
                <Plus className="size-3.5 mr-1" />
                Add Test
              </Button>
              {diffTests.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => runAllTests(diffTests)}
                  disabled={isRunningAll}
                >
                  {isRunningAll ? (
                    <Loader2 className="size-3.5 mr-1 animate-spin" />
                  ) : (
                    <Play className="size-3.5 mr-1" />
                  )}
                  Run All
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    )
  }

  // ─── Render: normal mode (no diff) ────────────────────────────────
  return (
    <div className="flex flex-col gap-2">
      {header}
      {!collapsed && (
        <>
          {tests.map((testCase) => (
            <TestCard
              key={testCase.id}
              testCase={testCase}
              depNodes={depNodes}
              runState={runState}
              onRun={() => runTest(testCase)}
              onChange={updateTests}
            />
          ))}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={addTest}>
              <Plus className="size-3.5 mr-1" />
              Add Test
            </Button>
            {tests.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => runAllTests(tests)}
                disabled={isRunningAll}
              >
                {isRunningAll ? (
                  <Loader2 className="size-3.5 mr-1 animate-spin" />
                ) : (
                  <Play className="size-3.5 mr-1" />
                )}
                Run All
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Normal (non-diff) test card ──────────────────────────────────────

function TestCard({
  testCase,
  depNodes,
  runState,
  onRun,
  onChange,
}: {
  testCase: NodeTestCase
  depNodes: ModelNode[]
  runState: TestRunState
  onRun: () => void
  onChange: (updater: (tests: NodeTestCase[]) => NodeTestCase[]) => void
}) {
  const result = runState[testCase.id]
  const isRunning = result === 'running'
  const testResult = result && result !== 'running' ? result : null

  return (
    <div
      className={cn(
        'border rounded-md p-3 flex flex-col gap-2',
        testResult?.passed === true && 'border-emerald-300 bg-emerald-50/50',
        testResult?.passed === false && 'border-red-300 bg-red-50/50'
      )}
    >
      {/* Header: name + actions */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Test name"
          value={testCase.name}
          onChange={(e) =>
            onChange((prev) =>
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
          onClick={() =>
            onChange((prev) => {
              const idx = prev.findIndex((t) => t.id === testCase.id)
              const dupe = createTestCase({
                name: testCase.name ? `${testCase.name} (copy)` : '',
                inputs: { ...testCase.inputs },
                expected: testCase.expected,
              })
              const next = [...prev]
              next.splice(idx + 1, 0, dupe)
              return next
            })
          }
        >
          <Copy className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-red-600"
          onClick={() =>
            onChange((prev) => prev.filter((t) => t.id !== testCase.id))
          }
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {/* Dependency inputs */}
      {depNodes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground font-medium">
            Inputs
          </span>
          {depNodes.map((dep) => (
            <div key={dep.id} className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground w-24 shrink-0 truncate">
                {dep.name}
              </label>
              <Input
                placeholder="value"
                value={
                  testCase.inputs[dep.id] !== undefined
                    ? String(testCase.inputs[dep.id])
                    : ''
                }
                onChange={(e) =>
                  onChange((prev) =>
                    prev.map((t) =>
                      t.id === testCase.id
                        ? {
                            ...t,
                            inputs: {
                              ...t.inputs,
                              [dep.id]: parseInputValue(e.target.value),
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

      {/* Expected */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground w-24 shrink-0">
          Expected
        </label>
        <Input
          placeholder="expected result"
          value={testCase.expected}
          onChange={(e) =>
            onChange((prev) =>
              prev.map((t) =>
                t.id === testCase.id ? { ...t, expected: e.target.value } : t
              )
            )
          }
          className="h-7 text-sm"
        />
      </div>

      {/* Result */}
      <TestResultDisplay result={testResult} />
    </div>
  )
}

// ─── Diff test card ───────────────────────────────────────────────────

function DiffTestCard({
  old: oldTest,
  new_: newTest,
  depNodes,
  runState,
  onRun,
  onUpdate,
  onDelete,
  onDuplicate,
}: {
  old: NodeTestCase | undefined
  new_: NodeTestCase | undefined
  depNodes: ModelNode[]
  runState: TestRunState
  onRun?: () => void
  onUpdate: (updater: (tests: NodeTestCase[]) => NodeTestCase[]) => void
  onDelete?: () => void
  onDuplicate?: () => void
}) {
  // Removed test: only exists in original
  if (!newTest) {
    return (
      <div className="border border-red-200 bg-red-50/50 rounded-md p-3 flex flex-col gap-2 opacity-60">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-red-600 shrink-0">
            Removed
          </span>
          <span className="text-sm line-through text-muted-foreground flex-1 truncate">
            {oldTest!.name || 'Unnamed test'}
          </span>
        </div>
        {depNodes.length > 0 && (
          <div className="flex flex-col gap-1">
            {depNodes.map((dep) => (
              <div key={dep.id} className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground w-24 shrink-0 truncate">
                  {dep.name}
                </label>
                <span className="text-xs text-muted-foreground line-through">
                  {oldTest!.inputs[dep.id] !== undefined
                    ? String(oldTest!.inputs[dep.id])
                    : ''}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground w-24 shrink-0">
            Expected
          </label>
          <span className="text-xs text-muted-foreground line-through">
            {oldTest!.expected}
          </span>
        </div>
      </div>
    )
  }

  // Added test: only exists in diff
  const isAdded = !oldTest
  // Modified test: exists in both, compare fields
  const isModified = oldTest !== undefined && !testCasesEqual(oldTest, newTest)

  const result = runState[newTest.id]
  const isRunning = result === 'running'
  const testResult = result && result !== 'running' ? result : null

  const fieldChanged = (oldVal: string, newVal: string) =>
    oldTest !== undefined && oldVal !== newVal

  return (
    <div
      className={cn(
        'border rounded-md p-3 flex flex-col gap-2',
        isAdded && 'border-emerald-300 bg-emerald-50/30',
        isModified && !testResult && 'border-amber-300',
        testResult?.passed === true && 'border-emerald-300 bg-emerald-50/50',
        testResult?.passed === false && 'border-red-300 bg-red-50/50'
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        {isAdded && (
          <span className="text-xs font-medium text-emerald-600 shrink-0">
            Added
          </span>
        )}
        {/* Show old name struck through if changed */}
        {fieldChanged(oldTest?.name ?? '', newTest.name) && (
          <span className="text-xs text-muted-foreground line-through shrink-0">
            {oldTest!.name}
          </span>
        )}
        <Input
          placeholder="Test name"
          value={newTest.name}
          onChange={(e) =>
            onUpdate((prev) =>
              prev.map((t) =>
                t.id === newTest.id ? { ...t, name: e.target.value } : t
              )
            )
          }
          className={cn(
            'h-7 text-sm flex-1',
            fieldChanged(oldTest?.name ?? '', newTest.name) && 'bg-emerald-100'
          )}
        />
        {onRun && (
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
        )}
        {onDuplicate && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground"
            onClick={onDuplicate}
          >
            <Copy className="size-3.5" />
          </Button>
        )}
        {onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-red-600"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>

      {/* Dependency inputs */}
      {depNodes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground font-medium">
            Inputs
          </span>
          {depNodes.map((dep) => {
            const oldVal =
              oldTest?.inputs[dep.id] !== undefined
                ? String(oldTest.inputs[dep.id])
                : ''
            const newVal =
              newTest.inputs[dep.id] !== undefined
                ? String(newTest.inputs[dep.id])
                : ''
            const changed = fieldChanged(oldVal, newVal)

            return (
              <div key={dep.id} className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground w-24 shrink-0 truncate">
                  {dep.name}
                </label>
                {changed && (
                  <span className="text-xs text-muted-foreground line-through shrink-0">
                    {oldVal}
                  </span>
                )}
                <Input
                  placeholder="value"
                  value={newVal}
                  onChange={(e) =>
                    onUpdate((prev) =>
                      prev.map((t) =>
                        t.id === newTest.id
                          ? {
                              ...t,
                              inputs: {
                                ...t.inputs,
                                [dep.id]: parseInputValue(e.target.value),
                              },
                            }
                          : t
                      )
                    )
                  }
                  className={cn('h-7 text-sm', changed && 'bg-emerald-100')}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* Expected */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground w-24 shrink-0">
          Expected
        </label>
        {fieldChanged(oldTest?.expected ?? '', newTest.expected) && (
          <span className="text-xs text-muted-foreground line-through shrink-0">
            {oldTest!.expected}
          </span>
        )}
        <Input
          placeholder="expected result"
          value={newTest.expected}
          onChange={(e) =>
            onUpdate((prev) =>
              prev.map((t) =>
                t.id === newTest.id ? { ...t, expected: e.target.value } : t
              )
            )
          }
          className={cn(
            'h-7 text-sm',
            fieldChanged(oldTest?.expected ?? '', newTest.expected) &&
              'bg-emerald-100'
          )}
        />
      </div>

      {/* Result */}
      <TestResultDisplay result={testResult} />
    </div>
  )
}

// ─── Shared result display ────────────────────────────────────────────

function TestResultDisplay({
  result,
}: {
  result: { passed: boolean; actual: string; messages: string[] } | null
}) {
  if (!result) return null
  return (
    <div className="flex items-center gap-2 text-xs">
      {result.passed ? (
        <Check className="size-3.5 text-emerald-600" />
      ) : (
        <X className="size-3.5 text-red-600" />
      )}
      <span className={cn(result.passed ? 'text-emerald-700' : 'text-red-700')}>
        {result.passed ? 'Passed' : `Failed — got: ${result.actual}`}
      </span>
      {result.messages.length > 0 && (
        <span className="text-muted-foreground truncate">
          {result.messages[0]}
        </span>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Merge original and diff tests by ID, preserving diff order */
function mergeTests(
  original: NodeTestCase[],
  diff: NodeTestCase[]
): { old?: NodeTestCase; new?: NodeTestCase }[] {
  const merged: { old?: NodeTestCase; new?: NodeTestCase }[] = []
  const originalById = new Map(original.map((t) => [t.id, t]))
  const usedOriginalIds = new Set<string>()

  // Walk the diff list — this is the "new" ordering
  for (const dt of diff) {
    const ot = originalById.get(dt.id)
    if (ot) usedOriginalIds.add(dt.id)
    merged.push({ old: ot, new: dt })
  }

  // Any originals not in diff are "removed"
  for (const ot of original) {
    if (!usedOriginalIds.has(ot.id)) {
      merged.push({ old: ot, new: undefined })
    }
  }

  return merged
}

function testCasesEqual(a: NodeTestCase, b: NodeTestCase): boolean {
  if (a.name !== b.name) return false
  if (a.expected !== b.expected) return false
  const aKeys = Object.keys(a.inputs).sort()
  const bKeys = Object.keys(b.inputs).sort()
  if (aKeys.length !== bKeys.length) return false
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false
    if (String(a.inputs[aKeys[i]]) !== String(b.inputs[bKeys[i]])) return false
  }
  return true
}

/** Try to parse as number/boolean/JSON, fall back to string */
function parseInputValue(raw: string): unknown {
  if (raw === '') return ''
  if (raw === 'true') return true
  if (raw === 'false') return false
  const num = Number(raw)
  if (!isNaN(num) && raw.trim() !== '') return num
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}
