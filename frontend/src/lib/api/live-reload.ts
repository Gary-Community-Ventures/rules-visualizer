type ReloadCallback = (rulesetId?: string) => void

const callbacks: ReloadCallback[] = []
let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelay = 1000

export function onReload(callback: ReloadCallback): () => void {
  callbacks.push(callback)
  return () => {
    const index = callbacks.indexOf(callback)
    if (index !== -1) callbacks.splice(index, 1)
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
          for (const cb of callbacks) {
            cb(data.rulesetId)
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
