import { loadFactGraphData, getRawFacts } from './src/store.js'
loadFactGraphData('../../data/factgraph')
const facts = getRawFacts('tax-withholding-estimator')!
for (const f of facts) {
  if (
    f.path === '/jobs/*/filerAssignment' ||
    f.path === '/jobs/*/amountLastPaycheck'
  ) {
    console.log(f.path, '→', JSON.stringify(f.raw.Override, null, 2))
  }
}
