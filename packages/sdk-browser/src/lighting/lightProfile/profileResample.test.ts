// A profile laid on a square of another side: bilinear between the texels about each centre, held to the edge.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fromHalf, toHalf } from '../../../../math/src/float/half.ts'
import { resampleProfile } from './profileResample.ts'

const gradient = (side: number) =>
  Uint16Array.from({ length: side * side }, (_, i) => toHalf((i % side) / (side - 1)))

test('the same side gives the same texels', () => {
  const texels = gradient(8)
  assert.deepEqual(resampleProfile(texels, 8, 8), texels)
})

test('half the side takes the mean of each pair of texels, a gradient staying a gradient held to the edge', () => {
  const out = resampleProfile(gradient(8), 8, 4)
  const row = [...out.subarray(0, 4)].map(fromHalf)
  // Texel x of the result lies between the source texels 2x and 2x + 1: their mean, (4x + 1) / 14.
  row.forEach((value, x) => assert.ok(Math.abs(value - (4 * x + 1) / 14) < 1e-3, `texel ${x}`))
  assert.deepEqual([...out.subarray(4, 8)], [...out.subarray(0, 4)], 'every row alike')
})

test('twice the side reads between the texels and holds the edge', () => {
  const out = resampleProfile(gradient(4), 4, 8)
  const row = [...out.subarray(0, 8)].map(fromHalf)
  assert.ok(Math.abs(row[0] - 0) < 1e-3, 'the first texel is the edge')
  assert.ok(Math.abs(row[7] - 1) < 1e-3, 'the last texel is the edge')
  assert.ok(
    row.every((value, x) => x === 0 || value >= row[x - 1]),
    'it rises',
  )
})
