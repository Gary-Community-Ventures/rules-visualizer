import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useModelContext, getNodePath } from '@/context/model-context'
import { executeRuleset } from '@/lib/api/rules-api'
import type { ModelNode } from '@/lib/model'

/** Convert string input overrides to typed values for the execution API */
function parseOverrides(
  overrides: Record<string, string>,
  nodes: Record<string, ModelNode>
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {}
  for (const [nodeId, rawValue] of Object.entries(overrides)) {
    if (rawValue === '') continue
    const node = nodes[nodeId]
    if (!node) continue
    const path = getNodePath(node.content)
    if (!path) continue
    try {
      inputs[path] = JSON.parse(rawValue)
    } catch {
      inputs[path] = rawValue
    }
  }
  return inputs
}

/** Build the entities payload the executor expects from the panel's
 *  string-keyed entity rows. Adds an auto-incremented `id` so the engine
 *  can reference each row. */
function buildEntities(
  data: Record<string, Record<string, string>[]>
): Record<string, Record<string, unknown>[]> | undefined {
  if (Object.keys(data).length === 0) return undefined
  return Object.fromEntries(
    Object.entries(data).map(([entity, rows]) => [
      entity,
      rows.map((row, i) => {
        const parsed: Record<string, unknown> = { id: i + 1 }
        for (const [key, val] of Object.entries(row)) {
          if (val === '') continue
          try {
            parsed[key] = JSON.parse(val)
          } catch {
            parsed[key] = val
          }
        }
        return parsed
      }),
    ])
  )
}

/**
 * Imperative actions over the execution runner. Lives in a hook so the
 * context stays a pure get/set surface — the API call + the
 * commit-aware-deferral in runOnBlur are orchestration, not state.
 *
 * Returns:
 *   runExecution(snapshot?)  — POST inputs/entities/asOf to the executor
 *                              and stash results/error into context state.
 *                              If a snapshot { inputOverrides, entityData,
 *                              asOfDate } is passed, uses that directly
 *                              (avoids ref-staleness when the caller knows
 *                              the next state right now). Otherwise reads
 *                              from refs that mirror committed state.
 *   runOnBlur()              — deferred runExecution; safe to call from
 *                              handlers that also dispatched a setState
 *   clearExecution()         — wipe results + error
 */
type ExecutionSnapshot = {
  inputOverrides: Record<string, string>
  entityData: Record<string, Record<string, string>[]>
  asOfDate?: string
}

export function useExecutionRunner() {
  const {
    rulesetId,
    model,
    inputOverrides,
    entityData,
    asOfDate,
    setIsExecuting,
    setExecutionResults,
    setExecutionError,
  } = useModelContext()

  // Mirror live state into refs so the run callback doesn't need them as
  // deps. useLayoutEffect (instead of useEffect) so refs reflect committed
  // state synchronously after render — runOnBlur defers via setTimeout(0)
  // and reads from these refs, so they need to be fresh by then.
  const inputOverridesRef = useRef(inputOverrides)
  const entityDataRef = useRef(entityData)
  const asOfDateRef = useRef(asOfDate)
  const modelNodesRef = useRef(model.nodes)
  useLayoutEffect(() => {
    inputOverridesRef.current = inputOverrides
    entityDataRef.current = entityData
    asOfDateRef.current = asOfDate
    modelNodesRef.current = model.nodes
  })

  const runExecution = useCallback(
    (snapshot?: ExecutionSnapshot) => {
      setIsExecuting(true)
      setExecutionError(null)
      const overrides = snapshot?.inputOverrides ?? inputOverridesRef.current
      const data = snapshot?.entityData ?? entityDataRef.current
      const asOf = snapshot?.asOfDate ?? asOfDateRef.current
      const inputs = parseOverrides(overrides, modelNodesRef.current)
      const entities = buildEntities(data)
      executeRuleset(rulesetId, inputs, entities, asOf)
        .then((results) => setExecutionResults(results))
        .catch((err) => {
          const message =
            err instanceof Error ? err.message : 'Execution failed'
          setExecutionError(message)
        })
        .finally(() => setIsExecuting(false))
    },
    [rulesetId, setIsExecuting, setExecutionResults, setExecutionError]
  )

  const clearExecution = useCallback(() => {
    setExecutionResults(null)
    setExecutionError(null)
  }, [setExecutionResults, setExecutionError])

  // Defer with a macrotask so React commits (which updates the refs above
  // via useLayoutEffect) before runExecution reads them. A microtask isn't
  // enough — React's commit in default-priority lanes can run after the
  // microtask queue drains.
  const runOnBlur = useCallback(() => {
    setTimeout(() => {
      const hasAnyInput = Object.values(inputOverridesRef.current).some(
        (v) => v !== ''
      )
      const hasEntityData = Object.values(entityDataRef.current).some(
        (rows) => rows.length > 0
      )
      if (hasAnyInput || hasEntityData) runExecution()
    }, 0)
  }, [runExecution])

  // Auto-run when a simulation scenario is loaded into the execution panel
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>
    const handler = () => {
      // Defer to let the state updates from the scenario loading settle
      timeoutId = setTimeout(() => runExecution(), 100)
    }
    window.addEventListener('simulation-scenario-loaded', handler)
    return () => {
      window.removeEventListener('simulation-scenario-loaded', handler)
      clearTimeout(timeoutId)
    }
  }, [runExecution])

  return useMemo(
    () => ({ runExecution, runOnBlur, clearExecution }),
    [runExecution, runOnBlur, clearExecution]
  )
}
