import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { MemorySaver } from '@langchain/langgraph'
import { AIMessageChunk } from '@langchain/core/messages'
import { getModel, type ChatContext } from '../config.js'
import { SEARCH_TOOLS } from '../tools/search.js'

// Shared checkpointers per thread
const checkpointers = new Map<string, MemorySaver>()

function getCheckpointer(threadId: string): MemorySaver {
  if (!checkpointers.has(threadId)) {
    checkpointers.set(threadId, new MemorySaver())
  }
  return checkpointers.get(threadId)!
}

function systemPrompt(ctx: ChatContext): string {
  return [
    `You are an AI assistant helping users understand a Fact Graph ruleset.`,
    `You can use tools to look up nodes, search, and explore dependencies. Keep answers concise and reference specific node names so the user can click them. Don't wrap node names in backticks or code formatting — just write them as plain text.`,
    `When explaining logic, reference the actual node names from the ruleset.`,
    `The rulesetId for tool calls is: "${ctx.rulesetId}"`,
  ].join('\n\n')
}

export type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_start'; name: string; id: string }
  | {
      type: 'tool_end'
      name: string
      id: string
      result: string
      status: string
    }
  | { type: 'done' }
  | { type: 'error'; content: string }

export async function* streamAgent(
  ctx: ChatContext,
  message: string,
  threadId: string,
  history?: { role: string; content: string }[]
): AsyncGenerator<AgentEvent> {
  const model = getModel()
  const checkpointer = getCheckpointer(threadId)

  const agent = createReactAgent({
    llm: model,
    tools: SEARCH_TOOLS,
    checkpointSaver: checkpointer,
    prompt: systemPrompt(ctx),
  })

  // Build input messages
  const messages: { role: string; content: string }[] = []
  if (history) {
    messages.push(...history)
  }
  messages.push({ role: 'user', content: message })

  try {
    const stream = agent.streamEvents(
      { messages },
      {
        configurable: { thread_id: threadId },
        version: 'v2',
      }
    )

    // Track tool call IDs so we can match start → end
    const pendingTools: { name: string; id: string }[] = []

    for await (const event of stream) {
      if (event.event === 'on_chat_model_stream') {
        const chunk = event.data?.chunk
        if (chunk instanceof AIMessageChunk) {
          const content = chunk.content
          if (typeof content === 'string' && content) {
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
        // Find the matching pending tool by name
        const pendingIdx = pendingTools.findIndex((t) => t.name === toolName)
        const toolId =
          pendingIdx >= 0
            ? pendingTools.splice(pendingIdx, 1)[0].id
            : (event.run_id ?? 'unknown')

        const result = output.content

        yield {
          type: 'tool_end',
          name: toolName,
          id: toolId,
          result,
          status: 'success',
        }
      }
    }

    yield { type: 'done' }
  } catch (err) {
    yield {
      type: 'error',
      content: err instanceof Error ? err.message : 'Agent execution failed',
    }
  }
}
