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

  // Watch all XML files in ruleset subdirectories
  const watcher = chokidar.watch('*/*.xml', {
    cwd: dataDir,
    ignoreInitial: true,
    usePolling: true,
    interval: 500,
  })

  watcher.on('change', (filePath) => {
    const rulesetId = filePath.split(path.sep)[0]
    console.log(`File changed: ${filePath}`)
    handleChange(rulesetId)
  })

  watcher.on('add', (filePath) => {
    const rulesetId = filePath.split(path.sep)[0]
    console.log(`File added: ${filePath}`)
    handleChange(rulesetId)
  })

  console.log(`Watching ${dataDir} for XML changes...`)
}
