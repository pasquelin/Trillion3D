import test from 'node:test'
import assert from 'node:assert/strict'
import { quantize } from './pageGrids.ts'

test("a half cell rounds away from zero, as the compiler's f64::round does", () => {
  // On a grid of 1/2: ±0.25 and ±1.25 sit half-way between two cells.
  const { min, cells } = quantize([-1.25, -0.25, 0.25, 1.25], 1, -1)
  assert.deepEqual(min, [-1.5])
  assert.deepEqual(cells, [0, 2, 4, 6], 'cells −3, −1, 1, 3 from −3')
})
