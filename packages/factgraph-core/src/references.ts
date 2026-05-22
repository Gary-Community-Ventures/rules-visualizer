import fs from 'node:fs'
import path from 'node:path'
import type {
  Model,
  PolicyReferences,
  ResolvedReference,
} from 'rules-visualizer-shared-types'

/**
 * Load `references.json` from a ruleset directory and attach resolved policy
 * citations onto the matching model nodes. Silently no-ops when the file is
 * absent or malformed — references are an optional enhancement, not a
 * requirement.
 *
 * `references.json` schema lives in `rules-visualizer-shared-types`. Nodes are
 * matched by path (Fact Graph nodes use their `path` as the node name).
 */
export function resolveReferences(model: Model, rulesetDir: string): void {
  const refPath = path.join(rulesetDir, 'references.json')
  if (!fs.existsSync(refPath)) return

  let refs: PolicyReferences
  try {
    refs = JSON.parse(fs.readFileSync(refPath, 'utf-8'))
  } catch (e) {
    console.warn(`  Warning: failed to parse references.json: ${e}`)
    return
  }

  const docsById = new Map(refs.documents.map((d) => [d.id, d]))
  const sectionsById = new Map(refs.sections.map((s) => [s.id, s]))

  const mappingsByPath = new Map<string, string[]>()
  for (const m of refs.mappings) {
    const list = mappingsByPath.get(m.nodePath) ?? []
    list.push(m.sectionId)
    mappingsByPath.set(m.nodePath, list)
  }

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
