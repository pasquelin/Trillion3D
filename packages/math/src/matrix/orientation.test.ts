// `matrixWindingCw` is the one mirror rule: the sign of the upper-left 3x3 determinant of a world
// matrix, read by the lit CPU raster and the blend pass to choose the culled face.
import test from 'node:test'
import assert from 'node:assert/strict'
import { matrixWindingCw } from './orientation.ts'

/** A column-major 4x4 of the diagonal `(x, y, z)`. */
const scale = (x: number, y: number, z: number) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]

test('the rule is the sign of the 3x3 determinant, not a scale reading', () => {
  assert.equal(matrixWindingCw(scale(1, 1, 1)), false)
  // A single inverted axis flips orientation; two restore it.
  assert.equal(matrixWindingCw(scale(1, -1, 1)), true)
  assert.equal(matrixWindingCw(scale(-1, -1, 1)), false)
  // A rotation flips nothing, regardless of accompanying translation.
  const c = Math.cos(1.2),
    s = Math.sin(1.2)
  assert.equal(matrixWindingCw([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 9, -4, 3, 1]), false)
})
