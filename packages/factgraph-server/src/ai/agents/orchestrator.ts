import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { MemorySaver } from '@langchain/langgraph'
import { AIMessageChunk } from '@langchain/core/messages'
import { getModel, type ChatContext } from '../config.js'
import { getRuleset } from '../../store.js'
import { SEARCH_TOOLS } from '../tools/search.js'
import { EXECUTION_TOOLS } from '../tools/execution.js'
import { TEST_TOOLS } from '../tools/tests.js'

// Shared checkpointers per thread
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
  const nodeCount = nodes.length
  const compact = nodeCount > 200

  const byType: Record<string, string[]> = {
    input: [],
    constant: [],
    computed: [],
  }

  // Track which nodes are depended on by others
  const isDependedOn = new Set<string>()
  const collections = new Set<string>()

  for (const node of nodes) {
    for (const depId of node.dependencies) {
      isDependedOn.add(depId)
    }
  }

  for (const node of nodes) {
    const c = node.content
    if (c.type === 'entity') continue

    // Detect collections
    if ('path' in c && c.path.includes('/*')) {
      const collPrefix = c.path.replace(/\/\*\/.*$/, '')
      collections.add(collPrefix)
    }

    const role =
      c.type === 'writable' ? 'input' : 'role' in c ? c.role : 'computed'
    const bucket = byType[role] ?? byType['computed']
    if (compact) {
      bucket.push(node.name)
    } else {
      const desc = node.description ? ` — ${node.description.slice(0, 60)}` : ''
      bucket.push(`${node.name}${desc}`)
    }
  }

  // Root/output nodes: computed nodes that no other node depends on
  const rootNodes = nodes
    .filter((n) => n.content.type === 'derived' && !isDependedOn.has(n.id))
    .map((n) => n.name)

  // Build summary header
  const summary = [
    `Ruleset: ${model.name} (${nodeCount} nodes)`,
    `  Inputs: ${byType.input.length}, Constants: ${byType.constant.length}, Computed: ${byType.computed.length}`,
    collections.size > 0
      ? `  Collections: ${[...collections].join(', ')}`
      : null,
    rootNodes.length > 0
      ? `  Root outputs (not used by other nodes): ${rootNodes.slice(0, 20).join(', ')}${rootNodes.length > 20 ? ` ... and ${rootNodes.length - 20} more` : ''}`
      : null,
  ]
    .filter(Boolean)
    .join('\n')

  const sections: string[] = [summary]
  if (byType.input.length)
    sections.push(
      `Inputs (${byType.input.length}):\n${byType.input.join('\n')}`
    )
  if (byType.constant.length)
    sections.push(
      `Constants (${byType.constant.length}):\n${byType.constant.join('\n')}`
    )
  if (byType.computed.length)
    sections.push(
      `Computed (${byType.computed.length}):\n${byType.computed.join('\n')}`
    )

  return sections.join('\n\n')
}

function systemPrompt(ctx: ChatContext): string {
  const nodeIndex = buildNodeIndex(ctx.rulesetId)

  return [
    `You are an AI assistant helping users understand, execute, and test a Fact Graph ruleset.`,
    `You have tools to:
- Explore nodes in detail (get_nodes, search_nodes, get_dependencies)
- Execute the graph with inputs (list_writable_inputs, execute_graph)
- Manage tests (list_tests, get_test, run_tests, create_test, edit_test, delete_test)`,
    `When executing or creating tests, use list_writable_inputs first to discover available inputs and their types. For Dollar values use plain numbers (e.g. 50000). For Boolean use true/false. For Enum use the string option name.

Collection-scoped nodes (paths containing /*) represent per-member fields. To set per-member values, use the "entities" parameter — NOT the "inputs" parameter. The entities parameter is a map of collection path → array of row objects. Each row uses the full wildcard path as the key.

Example for a /members collection with two members:
  entities: { "/members": [
    { "/members/*/age": 65, "/members/*/isElderly": true },
    { "/members/*/age": 30, "/members/*/isElderly": false }
  ]}

Scalar (non-collection) inputs go in the "inputs" parameter as usual. Never use numeric indexes like members/0/age — always use the /* wildcard path as the key within entity rows.

When the user asks for a profile/scenario they want to see in the graph (e.g. "show me a profile where the user is eligible"), pass applyToUi=true on execute_graph — the resolved inputs will be written into their UI (replacing existing inputs) so the values appear directly on the nodes. Omit applyToUi for sandbox/what-if computations the user didn't ask to see.`,
    `Be efficient with tool calls — batch node lookups into a single get_nodes call instead of calling it repeatedly. After at most 5-6 tool calls, synthesize what you have and respond to the user. You can always make more calls if they ask follow-up questions.

Start with the direct answer to the question. Keep answers to 2 sentences or fewer. Reference specific node names so the user can click them. Don't wrap node names in backticks or code formatting — just write them as plain text.`,
    `When explaining logic, reference the actual node names from the ruleset.`,
    `The rulesetId for tool calls is: "${ctx.rulesetId}"`,
    `Here is the complete node index for this ruleset. Use get_nodes to see full details for specific nodes.\n\n${nodeIndex}`,
  ].join('\n\n')
}

export type ToolApplyPayload = {
  inputs: Record<string, unknown>
  entities?: Record<string, Record<string, unknown>[]>
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
      /** Resolved inputs/entities the tool ran with — present whenever
       *  execute_graph completed; the FE shows a Reapply button. */
      apply?: ToolApplyPayload
      /** Auto-apply on receipt (corresponds to the AI's applyToUi flag).
       *  When false, the FE shows the Reapply button but doesn't push. */
      autoApply?: boolean
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
    tools: [...SEARCH_TOOLS, ...EXECUTION_TOOLS, ...TEST_TOOLS],
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
        recursionLimit: 40,
      }
    )

    // Track tool call IDs so we can match start → end
    const pendingTools: { name: string; id: string }[] = []
    let eventCount = 0
    let hasText = false
    let toolCallCount = 0

    // Timeout: if no events arrive within 60s, abort
    const TIMEOUT_MS = 60_000
    let lastEventTime = Date.now()
    const timeoutCheck = setInterval(() => {
      if (Date.now() - lastEventTime > TIMEOUT_MS) {
        clearInterval(timeoutCheck)
        console.error('[AI] Stream timed out after 60s of inactivity')
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
          // Find the matching pending tool by name
          const pendingIdx = pendingTools.findIndex((t) => t.name === toolName)
          const toolId =
            pendingIdx >= 0
              ? pendingTools.splice(pendingIdx, 1)[0].id
              : (event.run_id ?? 'unknown')

          const result = output.content
          // Tools using responseFormat='content_and_artifact' attach the
          // structured payload here. execute_graph uses it to push the
          // resolved inputs back to the FE — autoApply mirrors the AI's
          // applyToUi flag, the apply payload is always set on success so
          // the user can Reapply manually even when the AI didn't flag it.
          const artifact = output.artifact as
            | { apply?: ToolApplyPayload; autoApply?: boolean }
            | undefined
          toolCallCount++
          console.log(
            `[AI] Tool ${toolName} completed (${typeof result === 'string' ? result.length : 0} chars)`
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
      `[AI] Stream finished (${eventCount} events, ${toolCallCount} tool calls, hasText: ${hasText})`
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
    console.error('[AI] Stream error:', err)
    yield {
      type: 'error',
      content: err instanceof Error ? err.message : 'Agent execution failed',
    }
  }
}
