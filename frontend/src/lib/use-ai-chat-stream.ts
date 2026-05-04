import { useEffect, useRef } from 'react'
import { usePanelContext } from '@/context'
import { useApplyAiInputs } from './use-apply-ai-inputs'
import { onAiEvent, sendWsMessage, type AiEvent } from './api/live-reload'

/**
 * Owns the AI chat WebSocket subscription. Mounted once at HomePage level
 * (per tab) so the listener stays installed even when the user closes the
 * AI sidebar mid-stream — chunks/tool events keep flowing into the
 * persisted chat history in PanelContext.
 *
 * Also owns the request-id allocator + streaming text accumulator, and
 * publishes the matching `sendAiMessage` callback on PanelContext's
 * aiSendMessageRef so ChatBox can submit even after AIPanel has remounted.
 */
export function useAiChatStream() {
  const { setAiChatMessages, setAiChatLoading, aiSendMessageRef } =
    usePanelContext()
  const applyAiInputs = useApplyAiInputs()

  const requestIdRef = useRef(0)
  const aiContentRef = useRef('')

  useEffect(() => {
    return onAiEvent((event: AiEvent) => {
      const currentId = String(requestIdRef.current)
      if (event.requestId !== currentId) return

      switch (event.type) {
        case 'ai-chunk':
          aiContentRef.current += event.content
          setAiChatMessages((prev) => {
            const last = prev[prev.length - 1]
            if (last?.type === 'aiMessage') {
              return [
                ...prev.slice(0, -1),
                { type: 'aiMessage', message: aiContentRef.current },
              ]
            }
            return [
              ...prev,
              { type: 'aiMessage', message: aiContentRef.current },
            ]
          })
          break
        case 'ai-tool-start':
          aiContentRef.current = ''
          setAiChatMessages((prev) => [
            ...prev,
            {
              type: 'toolCall',
              name: event.name,
              id: event.id,
              status: 'pending',
            },
          ])
          break
        case 'ai-tool-end':
          setAiChatMessages((prev) =>
            prev.map((m) =>
              m.type === 'toolCall' && m.id === event.id
                ? {
                    ...m,
                    status: 'success' as const,
                    result: event.result,
                    apply: event.apply,
                  }
                : m
            )
          )
          if (event.apply && event.autoApply) applyAiInputs(event.apply)
          break
        case 'ai-done':
          setAiChatLoading(false)
          break
        case 'ai-error':
          if (event.content === 'Invalid AI password') {
            localStorage.removeItem('ai-password')
            // AIPanel listens and flips back to the password gate. Window
            // event because the panel may not be mounted right now and we
            // want it to pick this up on its next mount.
            window.dispatchEvent(new CustomEvent('ai-password-error'))
            setAiChatLoading(false)
            return
          }
          setAiChatMessages((prev) => [
            ...prev,
            { type: 'aiMessage', message: `Error: ${event.content}` },
          ])
          setAiChatLoading(false)
          break
      }
    })
  }, [setAiChatMessages, setAiChatLoading, applyAiInputs])

  // Publish the sender on the shared ref so ChatBox can submit. Stable
  // closure over the local refs — never re-creates, so ChatBox doesn't
  // need to re-read it.
  useEffect(() => {
    aiSendMessageRef.current = (args) => {
      aiContentRef.current = ''
      const reqId = ++requestIdRef.current
      sendWsMessage({
        type: 'ai-chat',
        requestId: String(reqId),
        rulesetId: args.rulesetId,
        message: args.message,
        password: args.password,
        history: args.history,
      })
    }
  }, [aiSendMessageRef])
}
