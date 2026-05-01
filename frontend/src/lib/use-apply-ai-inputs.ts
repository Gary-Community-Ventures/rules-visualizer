import { useCallback, useRef } from 'react'
import { useMainContext } from '@/context'
import { useInputActions } from './use-input-actions'
import { useExecutionRunner } from './use-execution-runner'
import { applySnapshot } from './profile-serialize'
import type { AiToolApplyPayload } from './api/live-reload'

/**
 * Apply an AI execute_graph apply-payload (resolved inputs/entities) to the
 * user's graph view. Wipes existing inputs/entities first so the payload is
 * the complete state, then runs the executor with the just-built snapshot
 * — refs mirror committed state on the next render, but applySnapshot
 * returns the panel-shape snapshot synchronously so we can hand it to
 * runExecution without the ref-staleness gotcha.
 *
 * Returns a stable callback so it can be invoked from event handlers (the
 * live ai-tool-end stream) and from explicit user actions like the Reapply
 * button on a tool-call message.
 */
export function useApplyAiInputs() {
  const { model, setEntityData } = useMainContext()
  const { clearAll, setInputOverride } = useInputActions()
  const { runExecution } = useExecutionRunner()

  const modelRef = useRef(model)
  modelRef.current = model

  return useCallback(
    (payload: AiToolApplyPayload) => {
      clearAll()
      setEntityData({})
      const snapshot = applySnapshot(
        modelRef.current.nodes,
        { inputs: payload.inputs, entities: payload.entities },
        setInputOverride,
        setEntityData
      )
      runExecution(snapshot)
    },
    [clearAll, setInputOverride, setEntityData, runExecution]
  )
}
