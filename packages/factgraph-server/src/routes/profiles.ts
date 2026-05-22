import { Router } from 'express'
import { getRuleset } from 'rules-visualizer-factgraph-core'
import { readProfiles, writeProfiles, type Profile } from '../profileStore.js'

const router = Router()

function writesBlocked(): boolean {
  return process.env.ALLOW_WRITES !== '1'
}
const READ_ONLY_MSG = 'Profiles are read-only (ALLOW_WRITES is not set)'

// GET /api/rulesets/:id/profiles
router.get('/rulesets/:id/profiles', (req, res) => {
  const model = getRuleset(req.params.id)
  if (!model) {
    res.status(404).json({ error: 'Ruleset not found' })
    return
  }
  res.json({ profiles: readProfiles(req.params.id) })
})

// POST /api/rulesets/:id/profiles
router.post('/rulesets/:id/profiles', (req, res) => {
  if (writesBlocked()) {
    res.status(403).json({ error: READ_ONLY_MSG })
    return
  }
  const model = getRuleset(req.params.id)
  if (!model) {
    res.status(404).json({ error: 'Ruleset not found' })
    return
  }
  const now = new Date().toISOString()
  const profiles = readProfiles(req.params.id)
  const newProfile: Profile = {
    id: crypto.randomUUID(),
    name: req.body.name ?? 'Untitled profile',
    description: req.body.description,
    asOf: req.body.asOf,
    inputs: req.body.inputs,
    overrides: req.body.overrides,
    entities: req.body.entities,
    createdAt: now,
    updatedAt: now,
  }
  profiles.push(newProfile)
  writeProfiles(req.params.id, profiles)
  res.json(newProfile)
})

// PUT /api/rulesets/:id/profiles/:profileId
router.put('/rulesets/:id/profiles/:profileId', (req, res) => {
  if (writesBlocked()) {
    res.status(403).json({ error: READ_ONLY_MSG })
    return
  }
  const profiles = readProfiles(req.params.id)
  const idx = profiles.findIndex((p) => p.id === req.params.profileId)
  if (idx === -1) {
    res.status(404).json({ error: 'Profile not found' })
    return
  }
  profiles[idx] = {
    ...profiles[idx],
    ...req.body,
    id: req.params.profileId,
    createdAt: profiles[idx].createdAt,
    updatedAt: new Date().toISOString(),
  }
  writeProfiles(req.params.id, profiles)
  res.json(profiles[idx])
})

// DELETE /api/rulesets/:id/profiles/:profileId
router.delete('/rulesets/:id/profiles/:profileId', (req, res) => {
  if (writesBlocked()) {
    res.status(403).json({ error: READ_ONLY_MSG })
    return
  }
  let profiles = readProfiles(req.params.id)
  const before = profiles.length
  profiles = profiles.filter((p) => p.id !== req.params.profileId)
  if (profiles.length === before) {
    res.status(404).json({ error: 'Profile not found' })
    return
  }
  writeProfiles(req.params.id, profiles)
  res.json({ success: true })
})

export default router
