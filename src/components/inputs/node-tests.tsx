import { useEffect, useRef, useState } from 'react'
import type { ModelNode, ModelNodes, NodeTestCase } from '@/lib/model'
import { createTestCase } from '@/lib/model'
import { useUpdateNode, useUpdateDiff } from '@/context'
import { runNodeTest, type TestResult } from '@/lib/api/dmn-api'
import { useMainContext } from '@/context'
import { Button } from '../ui/button'
import {
  Table,
  TableRow,
  TableInputCell,
  TableTextCell,
  TableFeelCell,
} from '../table'
import {
  Plus,
  Play,
  Check,
  X,
  Loader2,
  ChevronRight,
  Copy,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

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
  const runAllAbortRef = useRef<AbortController | null>(null)
  const singleAbortRef = useRef<AbortController | null>(null)

  // Abort in-flight tests on unmount
  useEffect(() => {
    return () => {
      runAllAbortRef.current?.abort()
      singleAbortRef.current?.abort()
    }
  }, [])

  const hasDiff = diff !== undefined

  const tests = node.tests ?? []
  const diffTests = diff?.tests ?? []

  // Only show input fields for non-constant dependencies (constants are
  // included in the mini model as-is and don't need user-provided values).
  // In diff mode, use the diff's dependencies (they may have changed).
  const activeDeps = hasDiff ? diff.dependencies : node.dependencies
  const depNodes = activeDeps
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
    if (runAllAbortRef.current) runAllAbortRef.current.abort()
    const controller = new AbortController()
    runAllAbortRef.current = controller
    setIsRunningAll(true)
    for (const tc of cases) {
      setRunState((s) => ({ ...s, [tc.id]: 'running' }))
    }
    try {
      for (const tc of cases) {
        if (controller.signal.aborted) return
        try {
          const result = await runNodeTest(
            model,
            node.id,
            tc,
            controller.signal
          )
          if (controller.signal.aborted) return
          setRunState((s) => ({ ...s, [tc.id]: result }))
        } catch (err) {
          if (controller.signal.aborted) return
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
    } finally {
      if (runAllAbortRef.current === controller) {
        runAllAbortRef.current = null
        setIsRunningAll(false)
      }
    }
  }

  const runTest = async (testCase: NodeTestCase) => {
    if (singleAbortRef.current) singleAbortRef.current.abort()
    const controller = new AbortController()
    singleAbortRef.current = controller
    setRunState((s) => ({ ...s, [testCase.id]: 'running' }))
    try {
      const result = await runNodeTest(
        model,
        node.id,
        testCase,
        controller.signal
      )
      if (controller.signal.aborted) return
      setRunState((s) => ({ ...s, [testCase.id]: result }))
    } catch (err) {
      if (controller.signal.aborted) return
      setRunState((s) => ({
        ...s,
        [testCase.id]: {
          passed: false,
          actual: '',
          status: 'FAILED',
          messages: [err instanceof Error ? err.message : 'Unknown error'],
        },
      }))
    } finally {
      if (singleAbortRef.current === controller) {
        singleAbortRef.current = null
      }
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
            {mergedTests.map((mt) => {
              const isRemoved = mt.new === undefined
              const testCase = mt.new ?? mt.old!

              return (
                <TestCard
                  key={mt.old?.id ?? mt.new!.id}
                  testCase={testCase}
                  oldTestCase={mt.old}
                  isRemoved={isRemoved}
                  depNodes={depNodes}
                  runState={runState}
                  onChange={isRemoved ? undefined : updateDiffTests}
                  onRun={isRemoved ? undefined : () => runTest(testCase)}
                  onDelete={
                    isRemoved
                      ? undefined
                      : () =>
                          updateDiffTests((prev) =>
                            prev.filter((t) => t.id !== testCase.id)
                          )
                  }
                  onDuplicate={
                    isRemoved
                      ? undefined
                      : () =>
                          updateDiffTests((prev) => {
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
                />
              )
            })}
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
              onChange={updateTests}
              onRun={() => runTest(testCase)}
              onDelete={() =>
                updateTests((prev) => prev.filter((t) => t.id !== testCase.id))
              }
              onDuplicate={() =>
                updateTests((prev) => {
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

// ─── Test card (handles normal, diff, added, and removed states) ─────

function TestCard({
  testCase,
  oldTestCase,
  isRemoved,
  depNodes,
  runState,
  onChange,
  onRun,
  onDelete,
  onDuplicate,
}: {
  testCase: NodeTestCase
  oldTestCase?: NodeTestCase
  isRemoved?: boolean
  depNodes: ModelNode[]
  runState: TestRunState
  onChange?: (updater: (tests: NodeTestCase[]) => NodeTestCase[]) => void
  onRun?: () => void
  onDelete?: () => void
  onDuplicate?: () => void
}) {
  const hasDiff = oldTestCase !== undefined
  const isAdded = !hasDiff && !isRemoved && onChange !== undefined
  const isModified = hasDiff && !testCasesEqual(oldTestCase, testCase)

  const result = runState[testCase.id]
  const isRunning = result === 'running'
  const testResult = result && result !== 'running' ? result : null

  const diffClass = (oldValue: string, newValue: string | undefined) => {
    if (isRemoved) return 'bg-red-100 line-through'
    if (!hasDiff) return ''
    if (oldValue !== newValue) return 'bg-emerald-100'
    return ''
  }

  // Columns: Field + Value (+ Value diff if has diff and not removed)
  const columns = hasDiff && !isRemoved ? 3 : 2

  return (
    <div
      className={cn(
        'border rounded-md p-3 flex flex-col gap-3',
        isRemoved && 'border-red-200 bg-red-50/50 opacity-60',
        isAdded && 'border-emerald-300 bg-emerald-50/30',
        isModified && !testResult && 'border-amber-300',
        testResult?.passed === true && 'border-emerald-300 bg-emerald-50/50',
        testResult?.passed === false && 'border-red-300 bg-red-50/50'
      )}
    >
      {/* Header: Name table + Action buttons */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Table columns={hasDiff && !isRemoved ? 2 : 1}>
            <TableRow>
              {hasDiff && !isRemoved && (
                <TableInputCell
                  value={oldTestCase?.name ?? ''}
                  onChange={() => {}}
                  disabled
                  className="bg-gray-100"
                />
              )}
              <TableInputCell
                value={testCase.name}
                onChange={(v) =>
                  onChange?.((prev) =>
                    prev.map((t) =>
                      t.id === testCase.id ? { ...t, name: v } : t
                    )
                  )
                }
                disabled={isRemoved}
                className={diffClass(oldTestCase?.name ?? '', testCase.name)}
              />
            </TableRow>
          </Table>
        </div>
        {!isRemoved && (
          <div className="flex items-center gap-1">
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
        )}
      </div>

      {/* Table */}
      <Table columns={columns}>
        {/* Input rows */}
        {depNodes.map((dep) => {
          const oldVal =
            oldTestCase?.inputs[dep.id] !== undefined
              ? String(oldTestCase.inputs[dep.id])
              : ''
          const newVal =
            testCase.inputs[dep.id] !== undefined
              ? String(testCase.inputs[dep.id])
              : ''

          return (
            <TableRow key={dep.id}>
              <TableTextCell className="bg-gray-50 text-muted-foreground">
                {dep.name}
              </TableTextCell>
              {hasDiff && !isRemoved && (
                <TableFeelCell
                  value={oldVal}
                  onChange={() => {}}
                  disabled
                  className="bg-gray-100"
                  dialect="expression"
                />
              )}
              <TableFeelCell
                value={newVal}
                onChange={(v) =>
                  onChange?.((prev) =>
                    prev.map((t) =>
                      t.id === testCase.id
                        ? {
                            ...t,
                            inputs: {
                              ...t.inputs,
                              [dep.id]: v,
                            },
                          }
                        : t
                    )
                  )
                }
                disabled={isRemoved}
                className={diffClass(oldVal, newVal)}
                dialect="expression"
              />
            </TableRow>
          )
        })}
        {/* Expected row */}
        <TableRow>
          <TableTextCell className="bg-cyan-100 text-black">
            Expected
          </TableTextCell>
          {hasDiff && !isRemoved && (
            <TableFeelCell
              value={oldTestCase?.expected ?? ''}
              onChange={() => {}}
              disabled
              className="bg-gray-100"
              dialect="expression"
            />
          )}
          <TableFeelCell
            value={testCase.expected}
            onChange={(v) =>
              onChange?.((prev) =>
                prev.map((t) =>
                  t.id === testCase.id ? { ...t, expected: v } : t
                )
              )
            }
            disabled={isRemoved}
            className={diffClass(oldTestCase?.expected ?? '', testCase.expected)}
            dialect="expression"
          />
        </TableRow>
      </Table>

      {/* Result */}
      {!isRemoved && <TestResultDisplay result={testResult} />}
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
