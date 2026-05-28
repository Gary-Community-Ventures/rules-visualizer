import { AIMessageChunk } from '@langchain/core/messages'
import { tool } from '@langchain/core/tools'
import { MemorySaver } from '@langchain/langgraph'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { z } from 'zod'
import { getRuleset } from 'rules-visualizer-factgraph-core'
import { getModel, type ChatContext } from '../config.js'
import { SEARCH_TOOLS } from '../tools/search.js'
import { READ_ONLY_EXECUTION_TOOLS } from '../tools/execution.js'
import type { AgentEvent, ToolApplyPayload } from './orchestrator.js'

const checkpointers = new Map<string, MemorySaver>()

function getCheckpointer(threadId: string): MemorySaver {
  if (!checkpointers.has(threadId)) {
    checkpointers.set(threadId, new MemorySaver())
  }
  return checkpointers.get(threadId)!
}

function buildNodeIndex(rulesetId: string): string {
  const model = getRuleset(rulesetId)
  if (!model) return ''

  const nodes = Object.values(model.nodes)
  const byType: Record<string, string[]> = {
    input: [],
    constant: [],
    computed: [],
  }

  for (const node of nodes) {
    const c = node.content
    if (c.type === 'entity') continue
    const role =
      c.type === 'writable' ? 'input' : 'role' in c ? c.role : 'computed'
    const bucket = byType[role] ?? byType.computed
    bucket.push(node.name)
  }

  return [
    `Ruleset: ${model.name} (${nodes.length} nodes)`,
    `Inputs (${byType.input.length}):\n${byType.input.join('\n')}`,
    `Constants (${byType.constant.length}):\n${byType.constant.join('\n')}`,
    `Computed (${byType.computed.length}):\n${byType.computed.join('\n')}`,
  ].join('\n\n')
}

function currentInterfaceExecutionTool(interfaceContext: unknown) {
  return tool(() => JSON.stringify(interfaceContext), {
    name: 'get_current_interface_execution',
    description:
      'Return the current interface execution context: visible results, all computed result values, scalar inputs, and collection entities. This is read-only and reflects the page state when the user asked the question.',
    schema: z.object({}),
  })
}

function systemPrompt(ctx: ChatContext): string {
  return [
    'You are an eligibility assistant for the interface page. Explain the current household/results and the fact graph logic behind them.',
    'You are read-only. Do not create, edit, delete, run, list, or reference tests. Do not apply values to the UI. Do not call mutation tools.',
    `You have read-only tools to:
- Read the current interface execution (get_current_interface_execution)
- Explore nodes in detail (get_nodes, search_nodes, get_dependencies)
- List available writable inputs and their types (list_writable_inputs)`,
    'Use get_current_interface_execution for the page state: visible results, all computed result values, scalar inputs, and collection rows. Entity rows use wildcard paths like /members/*/age. CollectionItem links use #0, #1, etc.',
    'Start with the direct answer. Keep answers to a few sentences unless the user asks for more detail. Prefer readable fact labels/node names over raw paths. Use compact Markdown tables when comparing multiple facts, people, amounts, or eligibility factors.',
    `The rulesetId for tool calls is: "${ctx.rulesetId}"`,
    `Here is the node index for this ruleset. Use get_nodes to inspect specific logic.\n\n${buildNodeIndex(ctx.rulesetId)}`,
  ].join('\n\n')
}

export async function* streamEligibilityInterfaceAgent(
  ctx: ChatContext,
  message: string,
  threadId: string,
  interfaceContext: unknown,
  history?: { role: string; content: string }[]
): AsyncGenerator<AgentEvent> {
  const model = getModel()
  const checkpointer = getCheckpointer(threadId)
  const agent = createReactAgent({
    llm: model,
    tools: [
      currentInterfaceExecutionTool(interfaceContext),
      ...SEARCH_TOOLS,
      ...READ_ONLY_EXECUTION_TOOLS,
    ],
    checkpointSaver: checkpointer,
    prompt: systemPrompt(ctx),
  })

  const messages: { role: string; content: string }[] = []
  if (history) messages.push(...history)
  messages.push({ role: 'user', content: message })

  try {
    const stream = agent.streamEvents(
      { messages },
      {
        configurable: { thread_id: threadId },
        version: 'v2',
        recursionLimit: 30,
      }
    )

    const pendingTools: { name: string; id: string }[] = []
    let eventCount = 0
    let hasText = false
    let toolCallCount = 0
    const TIMEOUT_MS = 60_000
    let lastEventTime = Date.now()
    const timeoutCheck = setInterval(() => {
      if (Date.now() - lastEventTime > TIMEOUT_MS) {
        clearInterval(timeoutCheck)
        console.error('[Eligibility AI] Stream timed out after 60s of inactivity')
      }
    }, 5000)

    try {
      for await (const event of stream) {
        lastEventTime = Date.now()
        eventCount++

        if (event.event === 'on_chat_model_stream') {
          const chunk = event.data?.chunk
          if (chunk instanceof AIMessageChunk) {
            const content = chunk.content
            if (typeof content === 'string' && content) {
              hasText = true
              yield { type: 'text', content }
            }

            if (chunk.tool_call_chunks?.length) {
              for (const tc of chunk.tool_call_chunks) {
                if (tc.name && tc.id) {
                  pendingTools.push({ name: tc.name, id: tc.id })
                  yield { type: 'tool_start', name: tc.name, id: tc.id }
                }
              }
            }
          }
        }

        if (event.event === 'on_tool_end') {
          const output = event.data?.output
          const toolName = event.name ?? 'unknown'
          const pendingIdx = pendingTools.findIndex((t) => t.name === toolName)
          const toolId =
            pendingIdx >= 0
              ? pendingTools.splice(pendingIdx, 1)[0].id
              : (event.run_id ?? 'unknown')
          const result = output.content
          const artifact = output.artifact as
            | { apply?: ToolApplyPayload; autoApply?: boolean }
            | undefined
          toolCallCount++
          console.log(
            `[Eligibility AI] Tool ${toolName} completed (${typeof result === 'string' ? result.length : 0} chars)`
          )
          yield {
            type: 'tool_end',
            name: toolName,
            id: toolId,
            result,
            status: 'success',
            apply: artifact?.apply,
            autoApply: artifact?.autoApply,
          }
        }
      }
    } finally {
      clearInterval(timeoutCheck)
    }

    console.log(
      `[Eligibility AI] Stream finished (${eventCount} events, ${toolCallCount} tool calls, hasText: ${hasText})`
    )
    if (!hasText && toolCallCount > 0) {
      yield {
        type: 'error',
        content:
          'The model completed tool calls but did not produce a response. Try asking a more specific follow-up question.',
      }
    }
    yield { type: 'done' }
  } catch (err) {
    console.error('[Eligibility AI] Stream error:', err)
    yield {
      type: 'error',
      content: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}
