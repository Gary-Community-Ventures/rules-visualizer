import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMainContext } from '@/context'
import { getNodeTests } from '@/lib/model'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import {
  FlaskConical,
  Loader2,
  Check,
  X,
  ChevronRight,
  ChevronDown,
  Play,
  Square,
} from 'lucide-react'
import {
  runNodeTest,
  runIntegrationTest,
  type TestResult,
  type IntegrationTestResult,
} from '@/lib/api/dmn-api'
import { IntegrationTestModal } from './integration-test-modal'

type TestState = {
  testId: string
  testName: string
  result: TestResult | 'running' | null
}

type NodeTestState = {
  nodeId: string
  nodeName: string
  tests: TestState[]
}

type IntegrationTestRunState = {
  testId: string
  testName: string
  result: IntegrationTestResult | 'running' | null
}

export function TestResultsPopover() {
  const { model, setOpenNode } = useMainContext()
  const [open, setOpen] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [nodeStates, setNodeStates] = useState<NodeTestState[]>([])
  const [integrationStates, setIntegrationStates] = useState<
    IntegrationTestRunState[]
  >([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const abortRef = useRef<AbortController | null>(null)
  const modelSnapshotRef = useRef<{
    nodes: Record<string, unknown>
    integrationTests: unknown
  } | null>(null)
  const [integrationModalOpen, setIntegrationModalOpen] = useState(false)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  const testableNodes = useMemo(
    () =>
      Object.values(model.nodes).filter(
        (node) =>
          node.content.type !== 'input' &&
          node.content.type !== 'constant' &&
          getNodeTests(node).length > 0
      ),
    [model.nodes]
  )

  const integrationTests = model.integrationTests ?? []
  const hasAnyTests = testableNodes.length > 0 || integrationTests.length > 0

  const runAll = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const nodes = Object.values(model.nodes).filter(
      (node) =>
        node.content.type !== 'input' &&
        node.content.type !== 'constant' &&
        getNodeTests(node).length > 0
    )

    const iTests = model.integrationTests ?? []

    if (nodes.length === 0 && iTests.length === 0) return

    // Initialize all unit tests as running
    const initial: NodeTestState[] = nodes.map((node) => ({
      nodeId: node.id,
      nodeName: node.name,
      tests: getNodeTests(node).map((tc) => ({
        testId: tc.id,
        testName: tc.name,
        result: 'running' as const,
      })),
    }))

    // Initialize all integration tests as running
    const initialIntegration: IntegrationTestRunState[] = iTests.map((tc) => ({
      testId: tc.id,
      testName: tc.name,
      result: 'running' as const,
    }))

    setNodeStates(initial)
    setIntegrationStates(initialIntegration)
    setIsRunning(true)
    setOpen(true)
    modelSnapshotRef.current = {
      nodes: model.nodes,
      integrationTests: model.integrationTests,
    }

    try {
      // Phase 1: Unit tests
      for (let ni = 0; ni < nodes.length; ni++) {
        const node = nodes[ni]
        const nodeTests = getNodeTests(node)
        for (let ti = 0; ti < nodeTests.length; ti++) {
          if (controller.signal.aborted) return

          const testCase = nodeTests[ti]
          let result: TestResult
          try {
            result = await runNodeTest(
              model,
              node.id,
              testCase,
              controller.signal
            )
          } catch (err) {
            if (controller.signal.aborted) return
            result = {
              passed: false,
              actual: '',
              status: 'NOT_EVALUATED',
              messages: [err instanceof Error ? err.message : 'Unknown error'],
            }
          }

          if (controller.signal.aborted) return

          setNodeStates((prev) =>
            prev.map((ns, nsi) => {
              if (nsi !== ni) return ns
              return {
                ...ns,
                tests: ns.tests.map((ts, tsi) => {
                  if (tsi !== ti) return ts
                  return { ...ts, result }
                }),
              }
            })
          )

          if (!result.passed) {
            setExpanded((prev) => new Set([...prev, node.id]))
          }
        }
      }

      // Phase 2: Integration tests
      for (let ii = 0; ii < iTests.length; ii++) {
        if (controller.signal.aborted) return

        const testCase = iTests[ii]
        let result: IntegrationTestResult
        try {
          result = await runIntegrationTest(
            model,
            testCase,
            controller.signal
          )
        } catch (err) {
          if (controller.signal.aborted) return
          result = {
            passed: false,
            assertionResults: {},
          }
        }

        if (controller.signal.aborted) return

        setIntegrationStates((prev) =>
          prev.map((is, isi) => {
            if (isi !== ii) return is
            return { ...is, result }
          })
        )

        if (!result.passed) {
          setExpanded((prev) => new Set([...prev, `itest-${testCase.id}`]))
        }
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setIsRunning(false)
      }
    }
  }, [model])

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setIsRunning(false)
  }, [])

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Compute summary stats — unit tests
  const unitTotal = nodeStates.reduce((sum, ns) => sum + ns.tests.length, 0)
  const unitPassed = nodeStates.reduce(
    (sum, ns) =>
      sum +
      ns.tests.filter(
        (t) => t.result !== null && t.result !== 'running' && t.result.passed
      ).length,
    0
  )
  const unitFailed = nodeStates.reduce(
    (sum, ns) =>
      sum +
      ns.tests.filter(
        (t) => t.result !== null && t.result !== 'running' && !t.result.passed
      ).length,
    0
  )

  // Compute summary stats — integration tests
  const integrationTotal = integrationStates.length
  const integrationPassed = integrationStates.filter(
    (s) => s.result !== null && s.result !== 'running' && s.result.passed
  ).length
  const integrationFailed = integrationStates.filter(
    (s) => s.result !== null && s.result !== 'running' && !s.result.passed
  ).length

  // Combined
  const totalTests = unitTotal + integrationTotal
  const passedTests = unitPassed + integrationPassed
  const failedTests = unitFailed + integrationFailed
  const hasResults = nodeStates.length > 0 || integrationStates.length > 0
  const isStale =
    hasResults &&
    !isRunning &&
    modelSnapshotRef.current !== null &&
    (modelSnapshotRef.current.nodes !== model.nodes ||
      modelSnapshotRef.current.integrationTests !== model.integrationTests)

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            title="Test Results"
            className="relative"
          >
            {isRunning ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FlaskConical className="size-4" />
            )}
            {hasResults && !isRunning && (
              <span
                className={`absolute -top-1 -right-1 size-4 rounded-full text-white text-xs flex items-center justify-center ${
                  isStale
                    ? 'bg-amber-500'
                    : failedTests > 0
                      ? 'bg-red-500'
                      : 'bg-green-500'
                }`}
              >
                {failedTests > 0 && !isStale ? failedTests : ''}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <div className="p-3 border-b flex items-center justify-between">
            <h4 className="font-semibold text-sm">Test Results</h4>
            {isRunning ? (
              <Button variant="ghost" size="sm" onClick={stop}>
                <Square className="size-3 mr-1" />
                Stop
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={runAll}
                disabled={!hasAnyTests}
              >
                <Play className="size-3 mr-1" />
                Run All
              </Button>
            )}
          </div>
          <div className="flex flex-col max-h-80 overflow-y-auto">
            {!hasResults ? (
              <p className="text-sm text-muted-foreground p-3">
                {!hasAnyTests
                  ? 'No tests defined'
                  : 'Click Run All to execute tests'}
              </p>
            ) : (
              <>
                {/* Unit Tests Section */}
                {nodeStates.length > 0 && (
                  <>
                    <div className="px-3 pt-2 pb-1">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Unit Tests
                      </span>
                    </div>
                    {nodeStates.map((ns) => {
                      const nodePassCount = ns.tests.filter(
                        (t) =>
                          t.result !== null &&
                          t.result !== 'running' &&
                          t.result.passed
                      ).length
                      const nodeTotal = ns.tests.length
                      const nodeHasFailure = ns.tests.some(
                        (t) =>
                          t.result !== null &&
                          t.result !== 'running' &&
                          !t.result.passed
                      )
                      const nodeAllDone = ns.tests.every(
                        (t) => t.result !== null && t.result !== 'running'
                      )
                      const isExpanded = expanded.has(ns.nodeId)

                      return (
                        <div
                          key={ns.nodeId}
                          className="border-b last:border-b-0"
                        >
                          <div className="flex items-center gap-1 p-2 hover:bg-muted transition-colors">
                            <button
                              onClick={() => toggleExpanded(ns.nodeId)}
                              className="shrink-0 p-0.5"
                            >
                              {isExpanded ? (
                                <ChevronDown className="size-3.5 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="size-3.5 text-muted-foreground" />
                              )}
                            </button>
                            <button
                              onClick={() => setOpenNode(ns.nodeId)}
                              className="text-sm font-medium truncate text-left flex-1"
                            >
                              {ns.nodeName}
                            </button>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {nodeAllDone
                                ? `${nodePassCount}/${nodeTotal}`
                                : `.../${nodeTotal}`}
                            </span>
                            {nodeAllDone &&
                              (nodeHasFailure ? (
                                <X className="size-3.5 text-red-500 shrink-0" />
                              ) : (
                                <Check className="size-3.5 text-green-500 shrink-0" />
                              ))}
                            {!nodeAllDone && (
                              <Loader2 className="size-3.5 animate-spin text-muted-foreground shrink-0" />
                            )}
                          </div>
                          {isExpanded && (
                            <div className="pl-8 pb-2">
                              {ns.tests.map((ts) => (
                                <div
                                  key={ts.testId}
                                  className="flex items-start gap-2 py-0.5 text-xs"
                                >
                                  {ts.result === null ? (
                                    <span className="size-3.5 shrink-0" />
                                  ) : ts.result === 'running' ? (
                                    <Loader2 className="size-3.5 animate-spin text-muted-foreground shrink-0 mt-px" />
                                  ) : ts.result.passed ? (
                                    <Check className="size-3.5 text-green-500 shrink-0 mt-px" />
                                  ) : (
                                    <X className="size-3.5 text-red-500 shrink-0 mt-px" />
                                  )}
                                  <div className="flex flex-col min-w-0">
                                    <span className="truncate text-muted-foreground">
                                      {ts.testName}
                                    </span>
                                    {ts.result !== null &&
                                      ts.result !== 'running' &&
                                      !ts.result.passed && (
                                        <span className="text-red-500 truncate">
                                          got: {ts.result.actual || '(empty)'}
                                        </span>
                                      )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </>
                )}

                {/* Integration Tests Section */}
                <div className="px-3 pt-2 pb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Integration Tests
                  </span>
                  <button
                    className="text-xs text-blue-600 hover:underline"
                    onClick={() => setIntegrationModalOpen(true)}
                  >
                    Manage
                  </button>
                </div>
                {integrationStates.length === 0 &&
                  integrationTests.length === 0 && (
                    <div className="px-3 pb-2">
                      <span className="text-xs text-muted-foreground">
                        No integration tests{' '}
                        <button
                          className="text-blue-600 hover:underline"
                          onClick={() => setIntegrationModalOpen(true)}
                        >
                          Create
                        </button>
                      </span>
                    </div>
                  )}
                {integrationStates.length === 0 &&
                  integrationTests.length > 0 &&
                  !isRunning && (
                    <div className="px-3 pb-2">
                      <span className="text-xs text-muted-foreground">
                        {integrationTests.length} test
                        {integrationTests.length !== 1 ? 's' : ''} defined
                      </span>
                    </div>
                  )}
                {integrationStates.map((is) => {
                  const isExpanded = expanded.has(`itest-${is.testId}`)
                  const result = is.result
                  const isTestRunning = result === 'running'
                  const testResult =
                    result && result !== 'running' ? result : null

                  return (
                    <div key={is.testId} className="border-b last:border-b-0">
                      <div className="flex items-center gap-1 p-2 hover:bg-muted transition-colors">
                        <button
                          onClick={() => toggleExpanded(`itest-${is.testId}`)}
                          className="shrink-0 p-0.5"
                        >
                          {isExpanded ? (
                            <ChevronDown className="size-3.5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="size-3.5 text-muted-foreground" />
                          )}
                        </button>
                        <span className="text-sm font-medium truncate flex-1">
                          {is.testName || 'Unnamed'}
                        </span>
                        {isTestRunning && (
                          <Loader2 className="size-3.5 animate-spin text-muted-foreground shrink-0" />
                        )}
                        {testResult &&
                          (testResult.passed ? (
                            <Check className="size-3.5 text-green-500 shrink-0" />
                          ) : (
                            <X className="size-3.5 text-red-500 shrink-0" />
                          ))}
                      </div>
                      {isExpanded && testResult && (
                        <div className="pl-8 pb-2">
                          {Object.entries(testResult.assertionResults).map(
                            ([nodeId, ar]) => {
                              const node = model.nodes[nodeId]
                              return (
                                <div
                                  key={nodeId}
                                  className="flex items-start gap-2 py-0.5 text-xs"
                                >
                                  {ar.passed ? (
                                    <Check className="size-3.5 text-green-500 shrink-0 mt-px" />
                                  ) : (
                                    <X className="size-3.5 text-red-500 shrink-0 mt-px" />
                                  )}
                                  <div className="flex flex-col min-w-0">
                                    <span className="truncate text-muted-foreground">
                                      {node?.name ?? nodeId}
                                    </span>
                                    {!ar.passed && (
                                      <span className="text-red-500 truncate">
                                        got: {ar.actual || '(empty)'}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )
                            }
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </>
            )}
          </div>
          {hasResults && (
            <div className="p-2 border-t text-xs text-muted-foreground">
              Total: {passedTests}/{totalTests} passed
              {failedTests > 0 && (
                <span className="text-red-500 ml-1">
                  ({failedTests} failed)
                </span>
              )}
              {isStale && (
                <span className="text-amber-600 ml-1">&middot; stale</span>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
      <IntegrationTestModal
        open={integrationModalOpen}
        onOpenChange={setIntegrationModalOpen}
      />
    </>
  )
}
