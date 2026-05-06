import { loadFactGraphData, getRuleset, getRawFacts } from './src/store.js'
import { executeFactGraph } from './src/executor.js'
loadFactGraphData('../../data/factgraph')
const m = getRuleset('tax-withholding-estimator')!
const facts = getRawFacts('tax-withholding-estimator')!

// Trigger amountLastPaycheck override by setting isPastJob=true
const r = executeFactGraph(
  'tax-withholding-estimator',
  facts,
  { '/filingStatus': 'single' },
  m.nodes as Record<string, { content: { dataType?: string } }>,
  { '/jobs': [{ id: 1, '/jobs/*/isPastJob': true, '/jobs/*/income': 70200 }] }
)
console.log('isPastJob:', r['/jobs/*/isPastJob'])
console.log(
  'amountLastPaycheck (Override Dollar 0):',
  r['/jobs/*/amountLastPaycheck']
)
console.log(
  'filerAssignment (Override Enum self):',
  r['/jobs/*/filerAssignment']
)
