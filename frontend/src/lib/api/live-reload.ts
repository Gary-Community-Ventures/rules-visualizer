type ReloadCallback = (rulesetId?: string) => void
type AiCallback = (event: AiEvent) => void

export type AiToolApplyPayload = {
  inputs: Record<string, unknown>
  entities?: Record<string, Record<string, unknown>[]>
}

export type AiEvent =
  | { type: 'ai-chunk'; requestId: string; content: string }
  | { type: 'ai-tool-start'; requestId: string; name: string; id: string }
  | {
      type: 'ai-tool-end'
      requestId: string
      name: string
      id: string
      result: string
      apply?: AiToolApplyPayload
      /** True when the tool was called with applyToUi — push to UI immediately. */
      autoApply?: boolean
    }
  | { type: 'ai-done'; requestId: string }
  | { type: 'ai-error'; requestId: string; content: string }

const reloadCallbacks: ReloadCallback[] = []
const aiCallbacks: AiCallback[] = []
let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelay = 1000

export function onReload(callback: ReloadCallback): () => void {
  reloadCallbacks.push(callback)
  return () => {
    const index = reloadCallbacks.indexOf(callback)
    if (index !== -1) reloadCallbacks.splice(index, 1)
  }
}

export function onAiEvent(callback: AiCallback): () => void {
  aiCallbacks.push(callback)
  return () => {
    const index = aiCallbacks.indexOf(callback)
    if (index !== -1) aiCallbacks.splice(index, 1)
  }
}

export function sendWsMessage(data: Record<string, unknown>): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data))
  }
}

export function connectLiveReload(): void {
  if (ws) return

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${protocol}//${window.location.host}/ws`

  try {
    ws = new WebSocket(url)

    ws.onopen = () => {
      reconnectDelay = 1000
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'reload') {
          for (const cb of reloadCallbacks) {
            cb(data.rulesetId)
          }
        } else if (data.type?.startsWith('ai-')) {
          for (const cb of aiCallbacks) {
            cb(data as AiEvent)
          }
        }
      } catch {
        // ignore invalid messages
      }
    }

    ws.onclose = () => {
      ws = null
      scheduleReconnect()
    }

    ws.onerror = () => {
      ws?.close()
    }
  } catch {
    scheduleReconnect()
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    reconnectDelay = Math.min(reconnectDelay * 2, 10000)
    connectLiveReload()
  }, reconnectDelay)
}
