// MUST be the first import — populates process.env from .env before any
// other module's top-level code runs (ES module imports are hoisted, so
// inline loadEnv() calls execute too late for env-gated middleware).
import './load-env.js'

import path from 'node:path'
import fs from 'node:fs'
import { loadFactGraphData } from 'rules-visualizer-factgraph-core'
import { createServer } from './server.js'

const args = process.argv.slice(2)
const dataDir = args[0] ? path.resolve(args[0]) : process.cwd()
const port = parseInt(process.env.PORT || '5002', 10)

if (!fs.existsSync(dataDir)) {
  console.error(`Directory not found: ${dataDir}`)
  process.exit(1)
}

if (!fs.statSync(dataDir).isDirectory()) {
  console.error(`Not a directory: ${dataDir}`)
  process.exit(1)
}

loadFactGraphData(dataDir)

createServer(port)
