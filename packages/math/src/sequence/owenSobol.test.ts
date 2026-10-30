// The Owen-scrambled Sobol sequence (`owenSobol.ts`): its points lie in [0, 1), the 16 points of a pixel's block fill the 4 × 4 cells of
// the unit square once each (a (0,2)-net), and two pixels take different points.
import test from 'node:test'
import assert from 'node:assert/strict'
import { owenSobolPoint } from './owenSobol.ts'

const block = (x: number, y: number) =>
  Array.from({ length: 16 }, (_, i) => owenSobolPoint(x, y, 0, i, 16))

test('the points lie in [0, 1)', () => {
  for (const point of block(3, 5)) for (const v of point) assert.ok(v >= 0 && v < 1, `${v}`)
})

test('the 16 points of a block of a pixel fill the 4 × 4 cells of the first two dimensions once each', () => {
  for (const [x, y] of [
    [0, 0],
    [3, 5],
    [200, 77],
  ]) {
    const cells = new Set(block(x, y).map(([u, v]) => Math.floor(u * 4) * 4 + Math.floor(v * 4)))
    assert.equal(cells.size, 16, `pixel ${x},${y}`)
  }
})

test('two pixels draw different points', () => {
  assert.notDeepEqual(block(0, 0), block(1, 0))
})
