import type { WebSocket } from 'ws'
import { streamAgent } from '../ai/agents/orchestrator.js'

type AiChatRequest = {
  type: 'ai-chat'
  requestId: string
  rulesetId: string
  message: string
  history?: { role: string; content: string }[]
}

function send(ws: WebSocket, data: Record<string, unknown>) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data))
  }
}

export async function handleAiChat(ws: WebSocket, data: AiChatRequest): Promise<void> {
  const { requestId, rulesetId, message, history } = data
  const threadId = requestId

  try {
    for await (const event of streamAgent({ rulesetId }, message, threadId, history)) {
      switch (event.type) {
        case 'text':
          send(ws, { type: 'ai-chunk', requestId, content: event.content })
          break
        case 'tool_start':
          send(ws, { type: 'ai-tool-start', requestId, name: event.name, id: event.id })
          break
        case 'tool_end':
          send(ws, { type: 'ai-tool-end', requestId, name: event.name, id: event.id, result: event.result })
          break
        case 'done':
          send(ws, { type: 'ai-done', requestId })
          break
        case 'error':
          send(ws, { type: 'ai-error', requestId, content: event.content })
          break
      }
    }
  } catch (err) {
    send(ws, {
      type: 'ai-error',
      requestId,
      content: err instanceof Error ? err.message : 'Chat failed',
    })
  }
}
