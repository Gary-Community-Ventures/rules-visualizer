import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { getRuleset, getDataDir, reloadRuleset } from '../store.js'
import type { PolicyReferences } from 'rules-visualizer-shared-types'

const router = Router()

function getRefsPath(rulesetId: string): string | null {
  const dataDir = getDataDir()
  if (!dataDir) return null
  return path.join(dataDir, rulesetId, 'references.json')
}

function readRefs(rulesetId: string): PolicyReferences {
  const refsPath = getRefsPath(rulesetId)
  if (!refsPath || !fs.existsSync(refsPath)) {
    return { documents: [], sections: [], mappings: [] }
  }
  try {
    return JSON.parse(fs.readFileSync(refsPath, 'utf-8'))
  } catch {
    return { documents: [], sections: [], mappings: [] }
  }
}

function writeRefs(rulesetId: string, refs: PolicyReferences): boolean {
  const refsPath = getRefsPath(rulesetId)
  if (!refsPath) return false
  fs.writeFileSync(refsPath, JSON.stringify(refs, null, 2) + '\n')
  return true
}

// GET /api/rulesets/:id/references
router.get('/rulesets/:id/references', (req, res) => {
  const model = getRuleset(req.params.id)
  if (!model) {
    res.status(404).json({ error: 'Ruleset not found' })
    return
  }
  res.json(readRefs(req.params.id))
})

// PUT /api/rulesets/:id/references — replace the entire manifest
router.put('/rulesets/:id/references', (req, res) => {
  // Writes (add/remove/edit refs) are gated by the same flag as the Tasks
  // API. When unset, the UI hides write affordances; the server still
  // refuses the call as a defense-in-depth measure.
  if (process.env.ALLOW_WRITES !== '1') {
    res.status(403).json({ error: 'References are read-only (ALLOW_WRITES is not set)' })
    return
  }
  const rulesetId = req.params.id
  const model = getRuleset(rulesetId)
  if (!model) {
    res.status(404).json({ error: 'Ruleset not found' })
    return
  }

  const refs = req.body as PolicyReferences
  if (!refs.documents || !refs.sections || !refs.mappings) {
    res.status(400).json({ error: 'Invalid references format' })
    return
  }

  if (!writeRefs(rulesetId, refs)) {
    res.status(500).json({ error: 'Failed to write references' })
    return
  }

  // Reload the ruleset so nodes get updated references
  const dataDir = getDataDir()
  if (dataDir) {
    reloadRuleset(rulesetId, path.join(dataDir, rulesetId))
  }

  res.json(refs)
})

// GET /api/rulesets/:id/references/files/:filename — serve a policy document file
router.get('/rulesets/:id/references/files/:filename', (req, res) => {
  const { id: rulesetId, filename } = req.params
  const model = getRuleset(rulesetId)
  if (!model) {
    res.status(404).json({ error: 'Ruleset not found' })
    return
  }

  const dataDir = getDataDir()
  if (!dataDir) {
    res.status(500).json({ error: 'No data directory' })
    return
  }

  // Prevent path traversal
  const safeName = path.basename(filename)
  const filePath = path.join(dataDir, rulesetId, safeName)

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' })
    return
  }

  const ext = path.extname(safeName).toLowerCase()
  const contentTypes: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
  }

  res.setHeader('Content-Type', contentTypes[ext] ?? 'application/octet-stream')
  res.sendFile(filePath)
})

export default router
