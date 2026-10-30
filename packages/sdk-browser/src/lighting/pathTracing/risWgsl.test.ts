// The choice by resampling: its WGSL names assemble, and a CPU mirror of the same steps keeps each candidate in proportion to its weight.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { assertProgramAssembles } from '../../gpu/core/wgslNames.fixture.ts'
import { PT_RIS_WGSL } from './risWgsl.ts'

/** The WGSL's steps, in doubles. */
const choose = (weights: readonly number[], rand: number) => {
  let sum = 0
  let r = rand
  let picked = -1
  weights.forEach((w, i) => {
    sum += w
    const total = sum > 0 ? sum : 1
    const scaled = r * total
    const keep = scaled < w
    r = Math.min((scaled - (keep ? 0 : w)) / (keep ? w : total - w), 0.99999994)
    if (keep) picked = i
  })
  return { picked, sum }
}

test('the resampling assembles', () => {
  const text = wgslProgram(
    '@compute @workgroup_size(1) fn main(){var r=ptRisStart(0.5);let k=ptRisAccept(&r,1.0);}',
    [PT_RIS_WGSL],
  )
  assertProgramAssembles(text, 'main', 'the resampling')
})

test('each candidate is chosen in proportion to its weight, the sum is the whole weight', () => {
  const weights = [0.5, 0.25, 0.25, 0]
  const counts = [0, 0, 0, 0]
  const n = 4096
  for (let i = 0; i < n; i++) {
    const { picked, sum } = choose(weights, (i + 0.5) / n)
    assert.equal(sum, 1)
    counts[picked]++
  }
  assert.deepEqual(
    counts.map((c) => Math.round((c / n) * 100) / 100),
    [0.5, 0.25, 0.25, 0],
  )
})

test('a first candidate with no weight is never kept, a single candidate always is', () => {
  assert.equal(choose([0, 1], 0.3).picked, 1)
  assert.equal(choose([0.2], 0.999).picked, 0)
  assert.equal(choose([0, 0], 0.4).picked, -1)
})
