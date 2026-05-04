/** AI sidebar chat history. Lives in PanelContext so it survives
 *  closing/reopening the AI panel — AIPanel unmounts on
 *  rightBar !== 'ai', and panel-local state would be lost otherwise. */

export type AiUserMessage = { type: 'userMessage'; message: string }
export type AiAssistantMessage = { type: 'aiMessage'; message: string }

/** Resolved inputs/entities captured for execute_graph calls so the user
 *  can reapply that exact snapshot later via a button on the message. */
export type AiToolApply = {
  inputs: Record<string, unknown>
  entities?: Record<string, Record<string, unknown>[]>
}

export type AiToolCallMessage = {
  type: 'toolCall'
  name: string
  id: string
  status: 'pending' | 'success' | 'error'
  result?: string
  apply?: AiToolApply
}

export type AiChatMessage =
  | AiUserMessage
  | AiAssistantMessage
  | AiToolCallMessage
