import { loadFactGraphData, getRuleset, getRawFacts } from './src/store.js'
import { executeFactGraph } from './src/executor.js'
loadFactGraphData('../../data/factgraph')
const m = getRuleset('snap-complete')
if (!m) {
  console.log('snap-complete not loaded')
  process.exit(1)
}
const facts = getRawFacts('snap-complete')!
// Two members, one income that should match member 1 as SSI
const r = executeFactGraph(
  'snap-complete',
  facts,
  {},
  m.nodes as Record<string, { content: { dataType?: string } }>,
  {
    '/members': [{ id: 1 }, { id: 2 }],
    '/incomes': [
      {
        id: 100,
        '/incomes/*/type': 'Ssi',
        '/incomes/*/memberId': /* this should reference member 1 */ 1,
      },
    ],
  }
)
console.log(
  'per-member receivesSsi:',
  r['/members/*/receivesSsiOrDisabilityBenefits']
)
console.log(
  'per-member isPersonWithDisability:',
  r['/members/*/isPersonWithDisability']
)
