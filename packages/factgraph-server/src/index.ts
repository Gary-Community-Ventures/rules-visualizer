import path from 'node:path'
import fs from 'node:fs'

// Load .env — search from cwd upward to find it
function loadEnv() {
  let dir = process.cwd()
  while (true) {
    const envFile = path.join(dir, '.env')
    if (fs.existsSync(envFile)) {
      for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq === -1) continue
        const key = trimmed.slice(0, eq)
        const value = trimmed.slice(eq + 1)
        if (!process.env[key]) process.env[key] = value
      }
      return
    }
    const parent = path.dirname(dir)
    if (parent === dir) return
    dir = parent
  }
}
loadEnv()

import { loadFactGraphData } from './store.js'
import { createServer } from './server.js'
import { startWatcher } from './watcher.js'

const args = process.argv.slice(2)
const dataDir = args[0] ? path.resolve(args[0]) : process.cwd()
const port = parseInt(process.env.PORT || '5000', 10)

// Validate directory
if (!fs.existsSync(dataDir)) {
  console.error(`Directory not found: ${dataDir}`)
  process.exit(1)
}

if (!fs.statSync(dataDir).isDirectory()) {
  console.error(`Not a directory: ${dataDir}`)
  process.exit(1)
}

// Load data
loadFactGraphData(dataDir)

// Start server
createServer(port)

// Start file watcher
startWatcher(dataDir)

// Open browser (non-blocking, don't fail if it can't open)
if (!process.env.NO_OPEN) {
  import('open')
    .then((mod) => mod.default(`http://localhost:${port}`))
    .catch(() => {})
}
