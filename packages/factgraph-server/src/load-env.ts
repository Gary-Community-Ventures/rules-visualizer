import path from 'node:path'
import fs from 'node:fs'

/**
 * Walk up from cwd looking for `.env` and copy any unset keys into
 * process.env. Lives in its own module so it can be imported BEFORE any
 * other module body runs — ES module imports are hoisted, so module-load
 * code in siblings (e.g. `app.use(taskRoutes)` gated on env) would see
 * an empty process.env if loadEnv was called inline from index.ts.
 */
function loadEnv(): void {
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
