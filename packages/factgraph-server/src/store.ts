import fs from 'node:fs'
import path from 'node:path'
import { parseFactGraphModules } from './parsers/factgraph.js'
import type { Model, RulesetSummary } from './types.js'

const models = new Map<string, Model>()

/**
 * Load Fact Graph rulesets from the given directory.
 *
 * Expected structure:
 *   <dataDir>/
 *     <ruleset-name>/       ← each subdirectory = one ruleset
 *       module1.xml
 *       module2.xml
 *
 * Each subdirectory is parsed as a multi-module ruleset.
 */
export function loadFactGraphData(dataDir: string): void {
  const entries = fs.readdirSync(dataDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    loadSingleRuleset(entry.name, path.join(dataDir, entry.name))
  }

  if (models.size === 0) {
    console.warn(`No rulesets found in ${dataDir}`)
  }
}

function loadSingleRuleset(rulesetId: string, rulesetDir: string): void {
  const xmlFiles = fs.readdirSync(rulesetDir).filter((f) => f.endsWith('.xml'))
  if (xmlFiles.length === 0) return

  const modules = xmlFiles.map((file) => ({
    name: path.basename(file, '.xml'),
    xml: fs.readFileSync(path.join(rulesetDir, file), 'utf-8'),
  }))

  const rulesetName = rulesetId
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

  const model = parseFactGraphModules(modules, rulesetId, rulesetName)
  models.set(rulesetId, model)
  console.log(
    `Loaded ruleset "${model.name}" (${Object.keys(model.nodes).length} nodes from ${modules.length} modules)`
  )
}

/**
 * Reload a single ruleset from disk. Called by the file watcher.
 */
export function reloadRuleset(rulesetId: string, rulesetDir: string): void {
  loadSingleRuleset(rulesetId, rulesetDir)
}

export function listRulesets(): RulesetSummary[] {
  return Array.from(models.values()).map((m) => ({
    id: m.id,
    name: m.name,
    format: m.format,
  }))
}

export function getRuleset(id: string): Model | undefined {
  return models.get(id)
}
