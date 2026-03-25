import fs from 'node:fs'
import path from 'node:path'
import { reloadRuleset } from './store.js'
import { broadcastReload } from './server.js'

/**
 * Watch a directory of Fact Graph XML modules for changes.
 * On change, re-parses the affected ruleset and notifies the frontend.
 */
export function startWatcher(dataDir: string): void {
  // Debounce: avoid re-parsing multiple times for rapid saves
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

  // Watch each ruleset subdirectory
  const entries = fs.readdirSync(dataDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const rulesetId = entry.name
    const rulesetDir = path.join(dataDir, rulesetId)

    fs.watch(rulesetDir, { recursive: true }, (eventType, filename) => {
      if (!filename || !filename.endsWith('.xml')) return
      console.log(`File ${eventType}: ${rulesetId}/${filename}`)
      handleChange(rulesetId)
    })
  }

  console.log(`Watching ${dataDir} for XML changes...`)
}
