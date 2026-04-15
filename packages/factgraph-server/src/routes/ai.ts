import { createHash, timingSafeEqual } from 'node:crypto'
import type { WebSocket } from 'ws'
import { streamAgent } from '../ai/agents/orchestrator.js'

type AiChatRequest = {
  type: 'ai-chat'
  requestId: string
  rulesetId: string
  message: string
  password?: string
  history?: { role: string; content: string }[]
}

function send(ws: WebSocket, data: Record<string, unknown>) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data))
  }
}

export async function handleAiChat(
  ws: WebSocket,
  data: AiChatRequest
): Promise<void> {
  const { requestId, rulesetId, message, history, password } = data

  // In production, require AI_PASSWORD to be set and matched (constant-time comparison)
  const requiredPassword = process.env.AI_PASSWORD
  if (requiredPassword) {
    const a = createHash('sha256')
      .update(password ?? '')
      .digest()
    const b = createHash('sha256').update(requiredPassword).digest()
    if (!timingSafeEqual(a, b)) {
      send(ws, {
        type: 'ai-error',
        requestId,
        content: 'Invalid AI password',
      })
      return
    }
  }
  const threadId = requestId

  try {
    for await (const event of streamAgent(
      { rulesetId },
      message,
      threadId,
      history
    )) {
      switch (event.type) {
        case 'text':
          send(ws, { type: 'ai-chunk', requestId, content: event.content })
          break
        case 'tool_start':
          send(ws, {
            type: 'ai-tool-start',
            requestId,
            name: event.name,
            id: event.id,
          })
          break
        case 'tool_end':
          send(ws, {
            type: 'ai-tool-end',
            requestId,
            name: event.name,
            id: event.id,
            result: event.result,
          })
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
