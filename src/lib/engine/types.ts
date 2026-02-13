import type { Model } from '@/lib/model'

export type ExecutionInputs = Record<string, unknown>

export type NodeResult = {
  decisionName: string
  result: unknown
  status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'NOT_EVALUATED'
  messages: string[]
}

export type ExecutionResult = {
  nodeResults: Record<string, NodeResult> // keyed by internal node ID
}

export interface DmnEngine {
  execute(
    model: Model,
    inputs: ExecutionInputs,
    signal?: AbortSignal
  ): Promise<ExecutionResult>
}
