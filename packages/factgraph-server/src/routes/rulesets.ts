import { Router } from 'express'
import { listRulesets, getRuleset } from '../store.js'

const router = Router()

router.get('/rulesets', (_req, res) => {
  res.json({ rulesets: listRulesets() })
})

router.get('/rulesets/:id', (req, res) => {
  const model = getRuleset(req.params.id)
  if (!model) {
    res.status(404).json({ error: 'Ruleset not found' })
    return
  }
  res.json(model)
})

router.post('/rulesets/:id/execute', (req, res) => {
  const model = getRuleset(req.params.id)
  if (!model) {
    res.status(404).json({ error: 'Ruleset not found' })
    return
  }
  res.status(501).json({
    error: 'Execution not yet implemented',
    message:
      'Rule execution will be available once the Scala.js bundle is integrated.',
  })
})

export default router
