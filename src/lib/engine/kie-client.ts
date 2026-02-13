import type { Model } from '@/lib/model'
import { exportModelToDmnXml, xmlId } from '@/lib/export'
import type {
  DmnEngine,
  ExecutionInputs,
  ExecutionResult,
  NodeResult,
} from './types'

type KieMessage =
  | {
      severity: string
      message: string
      messageType: string
      sourceId: string
    }
  | string

type KieDecisionResult = {
  decisionId: string
  decisionName: string
  result: unknown
  evaluationStatus: 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'NOT_EVALUATED'
  messages: KieMessage[]
}

type KieResponse = {
  namespace: string
  modelName: string
  dmnContext: Record<string, unknown>
  messages: KieMessage[]
  decisionResults: KieDecisionResult[]
}

export function createKieEngine(baseUrl: string): DmnEngine {
  return {
    async execute(
      model: Model,
      inputs: ExecutionInputs
    ): Promise<ExecutionResult> {
      const xmlString = exportModelToDmnXml(model)

      // Build reverse map: xmlId(nodeId) -> nodeId for all non-input nodes
      const reverseMap: Record<string, string> = {}
      for (const node of Object.values(model.nodes)) {
        if (node.content.type !== 'input') {
          reverseMap[xmlId(node.id)] = node.id
        }
      }

      const response = await fetch(`${baseUrl}/jitdmn/dmnresult`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: xmlString, context: inputs }),
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(
          `KIE execution failed (${response.status}): ${text || response.statusText}`
        )
      }

      const data: KieResponse = await response.json()
      console.log('[KIE] Raw response:', data)

      // Collect top-level messages to attach to failed nodes with no messages
      const topMessages = (data.messages ?? []).map((m) =>
        typeof m === 'string' ? m : m.message
      )

      const nodeResults: Record<string, NodeResult> = {}
      for (const dr of data.decisionResults) {
        const nodeId = reverseMap[dr.decisionId]
        if (nodeId) {
          const perNodeMessages = (dr.messages ?? []).map((m) =>
            typeof m === 'string' ? m : m.message
          )
          // If the node failed with no messages, use top-level messages
          const messages =
            perNodeMessages.length > 0
              ? perNodeMessages
              : dr.evaluationStatus === 'FAILED'
                ? topMessages
                : perNodeMessages
          nodeResults[nodeId] = {
            decisionName: dr.decisionName,
            result: dr.result,
            status: dr.evaluationStatus,
            messages,
          }
        }
      }

      return { nodeResults }
    },
  }
}
