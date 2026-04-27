import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { timingSafeEqual, createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Server } from 'node:http'
import rulesetRoutes from './routes/rulesets.js'
import testRoutes from './routes/tests.js'
import referenceRoutes from './routes/references.js'
import taskRoutes from './routes/tasks.js'
import { handleAiChat } from './routes/ai.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Pre-built frontend lives in public/ (copied at build time)
const FRONTEND_DIR = path.resolve(__dirname, '..', 'public')

const app = express()

// Basic auth in production (when BASIC_AUTH_USER and BASIC_AUTH_PASS are set)
const basicUser = process.env.BASIC_AUTH_USER
const basicPass = process.env.BASIC_AUTH_PASS
if (basicUser && basicPass) {
  app.use((req, res, next) => {
    const header = req.headers.authorization
    if (!header || !header.startsWith('Basic ')) {
      res.set('WWW-Authenticate', 'Basic realm="Rules Visualizer"')
      return res.status(401).send('Authentication required')
    }
    const [user, pass] = Buffer.from(header.slice(6), 'base64')
      .toString()
      .split(':')
    const userMatch = timingSafeEqual(
      createHash('sha256')
        .update(user ?? '')
        .digest(),
      createHash('sha256').update(basicUser).digest()
    )
    const passMatch = timingSafeEqual(
      createHash('sha256')
        .update(pass ?? '')
        .digest(),
      createHash('sha256').update(basicPass).digest()
    )
    if (!userMatch || !passMatch) {
      res.set('WWW-Authenticate', 'Basic realm="Rules Visualizer"')
      return res.status(401).send('Invalid credentials')
    }
    next()
  })
}

app.use(express.json())

// API routes
app.use('/api', rulesetRoutes)
app.use('/api', testRoutes)
app.use('/api', referenceRoutes)
app.use('/api', taskRoutes)

// Serve pre-built frontend static files if they exist
if (fs.existsSync(FRONTEND_DIR)) {
  app.use(express.static(FRONTEND_DIR))
  // SPA fallback — serve index.html for any non-API route
  app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'))
  })
}

// WebSocket for live reload
let wss: WebSocketServer

export function createServer(port: number): Server {
  const server = app.listen(port, () => {
    console.log(`Fact Graph server listening on http://localhost:${port}`)
    if (fs.existsSync(FRONTEND_DIR)) {
      console.log(`Serving frontend from ${FRONTEND_DIR}`)
    } else {
      console.log(
        `No frontend build found at ${FRONTEND_DIR} — run "npm run bundle-frontend" or use Vite dev server`
      )
    }
  })

  wss = new WebSocketServer({ server, path: '/ws' })
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'connected' }))

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(String(raw))
        if (data.type === 'ai-chat') {
          handleAiChat(ws, data)
        }
      } catch {
        // ignore malformed messages
      }
    })
  })

  return server
}

export function broadcastReload(rulesetId?: string): void {
  if (!wss) return
  const message = JSON.stringify({ type: 'reload', rulesetId })
  for (const client of wss.clients) {
    if (client.readyState === (client as WebSocket).OPEN) {
      client.send(message)
    }
  }
}
