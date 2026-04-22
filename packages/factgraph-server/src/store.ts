import fs from 'node:fs'
import path from 'node:path'
import { parseFactGraphModules } from './parsers/factgraph.js'
import type { Model, RulesetSummary } from './types.js'
import type {
  PolicyReferences,
  ResolvedReference,
} from 'rules-visualizer-shared-types'

export type RawFact = { path: string; raw: Record<string, unknown> }

const models = new Map<string, Model>()
const rawFacts = new Map<string, RawFact[]>()
let _dataDir: string | null = null

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
export function getDataDir(): string | null {
  return _dataDir
}

export function loadFactGraphData(dataDir: string): void {
  _dataDir = dataDir
  const entries = fs.readdirSync(dataDir, { withFileTypes: true })

  // Check if this directory has XML files directly (flat layout)
  const hasDirectXml = entries.some(
    (e) => e.isFile() && e.name.endsWith('.xml')
  )
  if (hasDirectXml) {
    loadSingleRuleset(path.basename(dataDir), dataDir)
  }

  // Also check subdirectories (nested layout)
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

  const result = parseFactGraphModules(modules, rulesetId, rulesetName)

  // Load policy references if references.json exists alongside the XML files
  resolveReferences(result.model, rulesetDir)

  models.set(rulesetId, result.model)
  rawFacts.set(rulesetId, result.facts)
  console.log(
    `Loaded ruleset "${result.model.name}" (${Object.keys(result.model.nodes).length} nodes from ${modules.length} modules)`
  )
}

/**
 * Load references.json and resolve mappings onto model nodes.
 */
function resolveReferences(model: Model, rulesetDir: string): void {
  const refPath = path.join(rulesetDir, 'references.json')
  if (!fs.existsSync(refPath)) return

  let refs: PolicyReferences
  try {
    refs = JSON.parse(fs.readFileSync(refPath, 'utf-8'))
  } catch (e) {
    console.warn(`  Warning: failed to parse references.json: ${e}`)
    return
  }

  // Build lookup maps
  const docsById = new Map(refs.documents.map((d) => [d.id, d]))
  const sectionsById = new Map(refs.sections.map((s) => [s.id, s]))

  // Group mappings by node path
  const mappingsByPath = new Map<string, string[]>()
  for (const m of refs.mappings) {
    const list = mappingsByPath.get(m.nodePath) ?? []
    list.push(m.sectionId)
    mappingsByPath.set(m.nodePath, list)
  }

  // Resolve onto nodes
  for (const node of Object.values(model.nodes)) {
    const nodePath = node.name // FG nodes use path as name
    const sectionIds = mappingsByPath.get(nodePath)
    if (!sectionIds) continue

    const resolved: ResolvedReference[] = []
    for (const sectionId of sectionIds) {
      const section = sectionsById.get(sectionId)
      if (!section) continue
      const document = docsById.get(section.documentId)
      if (!document) continue
      resolved.push({ section, document })
    }
    if (resolved.length > 0) {
      node.references = resolved
    }
  }
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

export function getRawFacts(id: string): RawFact[] | undefined {
  return rawFacts.get(id)
}
