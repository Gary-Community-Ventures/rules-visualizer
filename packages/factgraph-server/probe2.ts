import { loadFactGraphData, getRuleset, getRawFacts } from './src/store.js'
import { executeFactGraph } from './src/executor.js'

loadFactGraphData('../../data/factgraph')

const m = getRuleset('tax-withholding-estimator')!
const facts = getRawFacts('tax-withholding-estimator')!

console.log('--- MFJ (override condition false) ---')
let r = executeFactGraph(
  'tax-withholding-estimator', facts,
  { '/filingStatus': 'marriedFilingJointly' },
  m.nodes as Record<string, { content: { dataType?: string } }>,
  { '/jobs': [{ id: 1, '/jobs/*/filerAssignment': 'self', '/jobs/*/income': 70200 }] }
)
console.log('filerAssignment:', r['/jobs/*/filerAssignment'])
console.log('isFilerAssignmentSelf:', r['/jobs/*/isFilerAssignmentSelf'])

console.log('--- MFJ writing "spouse" ---')
r = executeFactGraph(
  'tax-withholding-estimator', facts,
  { '/filingStatus': 'marriedFilingJointly' },
  m.nodes as Record<string, { content: { dataType?: string } }>,
  { '/jobs': [{ id: 1, '/jobs/*/filerAssignment': 'spouse', '/jobs/*/income': 70200 }] }
)
console.log('filerAssignment:', r['/jobs/*/filerAssignment'])
console.log('isFilerAssignmentSelf:', r['/jobs/*/isFilerAssignmentSelf'])
