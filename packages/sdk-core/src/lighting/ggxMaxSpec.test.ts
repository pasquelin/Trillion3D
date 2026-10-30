// The GGX peak table of the toon shading (`ggxMaxSpec.ts`): held as data and checked against the builder, a texel at a time.
import test from 'node:test'
import assert from 'node:assert/strict'
import { GGX_MAX_SIZE, ggxMaxSpecWords } from './ggxMaxSpec.ts'
import { GGX_MAX_SPEC_TABLE } from './ggxMaxSpecTable.ts'
import { GGX_MAX_VIEWS, ggxMaxEnergy, ggxMaxTexel } from './ggxMaxSpec.fixture.ts'

const at = (column: number, row: number) => (row * GGX_MAX_SIZE + column) * GGX_MAX_VIEWS

test('the table held as data is the builder’s, texel by texel as 32-bit floats', () => {
  assert.equal(GGX_MAX_SPEC_TABLE.length, GGX_MAX_SIZE * GGX_MAX_SIZE * GGX_MAX_VIEWS)
  for (const [column, row] of [
    [0, 0],
    [31, 0],
    [12, 7],
    [20, 31],
    [31, 31],
  ])
    assert.deepEqual(
      Array.from(GGX_MAX_SPEC_TABLE.subarray(at(column, row), at(column, row) + GGX_MAX_VIEWS)),
      Array.from(ggxMaxTexel(column, row)),
      `texel ${column}, ${row}`,
    )
})

test('every value is held to [0, 1] and a wider lobe keeps a larger share', () => {
  for (const v of GGX_MAX_SPEC_TABLE) assert.ok(v >= 0 && v <= 1)
  for (let column = 1; column < GGX_MAX_SIZE; column++)
    assert.ok(GGX_MAX_SPEC_TABLE[at(column, 0) + 3] >= GGX_MAX_SPEC_TABLE[at(column - 1, 0) + 3])
})

test('the words hold each texel’s four values in 16-bit unsigned integers, two words a texel', () => {
  const words = ggxMaxSpecWords()
  assert.equal(words.length, GGX_MAX_SIZE * GGX_MAX_SIZE * 2)
  const texel = at(31, 31)
  for (let k = 0; k < GGX_MAX_VIEWS; k++) {
    const word = words[(texel / GGX_MAX_VIEWS) * 2 + (k >> 1)]
    const held = ((k & 1) === 0 ? word & 0xffff : word >>> 16) / 65535
    assert.ok(Math.abs(held - GGX_MAX_SPEC_TABLE[texel + k]) <= 1 / 65535)
  }
})

test('the lobe times the factor reaches one at its peak, from a little above', () => {
  for (const roughness of [0.3, 0.5, 0.8, 1])
    for (const noV of [0.05, 0.5, 1]) {
      const alpha = roughness * roughness
      const peak = 1 / (Math.PI * alpha * alpha)
      const reached = peak * ggxMaxEnergy(roughness, 0, noV)
      assert.ok(reached >= 0.99 && reached < 1.05, `${roughness} ${noV}: ${reached}`)
    }
})

test('the view cosines blend by their distance: a cosine of one is the last value, a cosine between two is their blend', () => {
  const last = ggxMaxEnergy(1, 1, 1)
  assert.ok(Math.abs(last - GGX_MAX_SPEC_TABLE[at(31, 31) + 3] * Math.PI) < 1e-4)
  const a = ggxMaxEnergy(0.7, 0.3, 0.3333),
    b = ggxMaxEnergy(0.7, 0.3, 0.6666),
    mid = ggxMaxEnergy(0.7, 0.3, 0.49995)
  assert.ok(mid >= Math.min(a, b) - 1e-6 && mid <= Math.max(a, b) + 1e-6)
})
