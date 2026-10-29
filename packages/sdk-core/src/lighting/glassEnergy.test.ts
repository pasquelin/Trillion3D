// The glass energy table (`glassEnergy.ts`): held as data, checked against the builder texel by texel.
import test from 'node:test'
import assert from 'node:assert/strict'
import { GLASS_ENERGY_SIZE, glassEnergyEta, glassEnergyWords } from './glassEnergy.ts'
import { GLASS_ENERGY_SAMPLES, glassEnergyTexel } from './glassEnergy.fixture.ts'
import { unorm16 } from './environmentBrdf.ts'

const N = GLASS_ENERGY_SIZE
const texels = [
  [0, 0, 0],
  [31, 31, 31],
  [5, 20, 0],
  [17, 3, 12],
  [30, 14, 31],
  [9, 28, 20],
  [1, 1, 16],
] as const

test('the index of the layers runs over one to three', () => {
  assert.equal(glassEnergyEta(0), 1)
  assert.equal(glassEnergyEta(1), 3)
  assert.equal(glassEnergyEta((16 + 0.5) / N), 1 + 2 * (16.5 / N))
})

test('the table holds a word a texel, the two albedos in 16-bit halves', () => {
  assert.equal(glassEnergyWords().length, N * N * N)
})

test('texels of the data are the builder’s, at its samples', () => {
  for (const [column, row, layer] of texels) {
    const [a, b] = glassEnergyTexel(
      (column + 0.5) / N,
      (row + 0.5) / N,
      glassEnergyEta((layer + 0.5) / N),
      column,
      row,
      layer,
      GLASS_ENERGY_SAMPLES,
    )
    const word = glassEnergyWords()[(layer * N + row) * N + column]
    assert.equal(word & 0xffff, unorm16(a), `in at ${column},${row},${layer}`)
    assert.equal(word >>> 16, unorm16(b), `out at ${column},${row},${layer}`)
  }
})

test('a smooth glass seen along its normal keeps nearly all the light, and never more than there is', () => {
  const [inside, outside] = glassEnergyTexel(1, 0.02, 1.5, 31, 0, 8, 1 << 10)
  assert.ok(inside > 0.95 && inside <= 1.05, String(inside))
  assert.ok(outside > 0.9 && outside <= 1.05, String(outside))
})
