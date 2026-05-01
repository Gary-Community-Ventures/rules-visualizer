import path from 'node:path'
import fs from 'node:fs'
import chokidar from 'chokidar'
import { reloadRuleset } from './store.js'
import { broadcastReload } from './server.js'

/**
 * Watch a directory of Fact Graph XML modules for changes.
 * On change, re-parses the affected ruleset and notifies the frontend.
 * Uses chokidar for reliable file watching on all platforms (including WSL).
 */
export function startWatcher(dataDir: string): void {
  const pending = new Map<string, ReturnType<typeof setTimeout>>()

  const handleChange = (rulesetId: string) => {
    if (pending.has(rulesetId)) {
      clearTimeout(pending.get(rulesetId))
    }
    pending.set(
      rulesetId,
      setTimeout(() => {
        pending.delete(rulesetId)
        console.log(`Reloading ruleset "${rulesetId}"...`)
        try {
          reloadRuleset(rulesetId, path.join(dataDir, rulesetId))
          broadcastReload(rulesetId)
          console.log(`Reloaded "${rulesetId}" successfully`)
        } catch (err) {
          console.error(`Failed to reload ruleset "${rulesetId}":`, err)
        }
      }, 300)
    )
  }

  // Watch the data directory. Chokidar v4+ removed glob support, so we watch
  // recursively and filter to XML files by extension.
  const watcher = chokidar.watch(dataDir, {
    ignoreInitial: true,
    usePolling: true,
    interval: 500,
    ignored: (p) => {
      // Skip node_modules/.git and anything that isn't XML (except dirs)
      if (p.includes('node_modules') || p.includes('/.git/')) return true
      return false
    },
  })

  const handleFileEvent = (absPath: string, eventType: string) => {
    if (
      !absPath.endsWith('.xml') &&
      !absPath.endsWith('references.json') &&
      !absPath.endsWith('profiles.json')
    )
      return
    const relative = path.relative(dataDir, absPath)
    const rulesetId = relative.split(path.sep)[0]
    if (!rulesetId) return
    console.log(`File ${eventType}: ${relative}`)
    handleChange(rulesetId)
  }

  watcher.on('change', (p) => handleFileEvent(p, 'changed'))
  watcher.on('add', (p) => handleFileEvent(p, 'added'))

  console.log(`Watching ${dataDir} for XML changes...`)
}
