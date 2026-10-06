// Volume bench: sdk-core against Three.js.
import { stress, rapport } from '../../core/index.ts'
import { boxCases } from './support/volumeBoxCases.ts'
import { casTronc } from './support/volumeFrustumCases.ts'
import { boxEmpty } from '../../../packages/sdk-core/src/index.ts'

// Warm-up and the round floor are the harness's (`bench/core/chrono.ts`).
const options = { tours: 30, budgetMs: 500 }
const tousLesCas = [...boxCases, ...casTronc]

// A computation without `reference` is measured without an oracle, and its line publishes the
// `motif` that says why and where its correctness is held: it is never simply silenced.
const results = []
for (const item of tousLesCas) results.push(await item.run(options))

await stress({
  name: 'boxEmpty extremes',
  calculation: () => {
    const b = new Float64Array(6)
    boxEmpty(b, 0)
    return b
  },
  extremes: [{ name: 'appel', input: null }],
})

rapport(
  'volumes',
  results,
  'each sdk-core volume yields exactly what Three.js yields, hierarchies included',
)
