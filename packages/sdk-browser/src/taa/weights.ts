// The table of the current-frame filter's weights (`filterWeights.ts`), one row per jitter rank.
import { TAA_SAMPLES, taaJitter } from './jitter.ts'
import { TAA_WEIGHTS, taaWeights } from './filterWeights.ts'

/** Weights of each of the `TAA_SAMPLES` jitter ranks, ready to copy into the uniform. */
export function taaWeightTable() {
  const jitter = new Float64Array(2)
  return Array.from({ length: TAA_SAMPLES }, (_, sample) => {
    taaJitter(sample, jitter)
    return taaWeights(jitter[0], jitter[1], new Float32Array(TAA_WEIGHTS), 0)
  })
}
