import test from 'node:test'
import assert from 'node:assert/strict'
import { basisMatrix4, decomposeMatrix4, uniformScaleMatrix4 } from './matrix4Trs.ts'
import { composeMatrix4 } from './matrix4Compose.ts'
import { determinantMatrix4 } from './matrix4.ts'
import { length3 } from '../vector/vector.ts'
import { nearly } from '../float/near.fixture.ts'

test('composeMatrix4: identity and translation only, last row (0,0,0,1) exact', () => {
  const out = composeMatrix4(new Float64Array(16), [1, 2, 3], [0, 0, 0, 1], [1, 1, 1])
  assert.deepEqual([...out], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1])
})

test('composeMatrix4: 90° rotation around z, x and y columns swapped and signed', () => {
  const s = Math.SQRT1_2 // quaternion (0, 0, sin45, cos45)
  const out = composeMatrix4(new Float64Array(16), [0, 0, 0], [0, 0, s, s], [1, 1, 1])
  assert.ok(nearly(out[0], 0) && nearly(out[1], 1), 'column x becomes +y')
  assert.ok(nearly(out[4], -1) && nearly(out[5], 0), 'column y becomes -x')
  assert.ok(nearly(out[10], 1))
})

test('decomposeMatrix4: the x scale is negative exactly where determinantMatrix4 is, affine or not', () => {
  const edges = [0, -0, 0.5, -1, 2, 1e100, -1e101, 1e300, Infinity, -Infinity, NaN]
  let seed = 7
  const next = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1
  const pick = () => (next() < -0.6 ? edges[Math.floor((next() + 1) * 5.5)] : next() * 4)
  const m = new Float64Array(16),
    p = new Float64Array(3),
    q = new Float64Array(4),
    s = new Float64Array(3)
  for (let k = 0; k < 200_000; k++) {
    for (let i = 0; i < 16; i++) m[i] = pick()
    // Mostly affine rows, sometimes a projective one, so both paths run.
    if (k % 8 !== 0) {
      m[3] = k % 3 ? 0 : -0
      m[7] = m[11] = 0
      m[15] = 1
    }
    decomposeMatrix4(m, p, q, s)
    const sx = length3(m[0], m[1], m[2])
    assert.ok(Object.is(s[0], determinantMatrix4(m) < 0 ? -sx : sx), `matrix ${[...m]}`)
  }
})

test('decomposeMatrix4: an infinite translation leaves the determinant NaN, so the x scale stays positive', () => {
  const m = new Float64Array([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, Infinity, 0, 0, 1])
  const p = new Float64Array(3),
    q = new Float64Array(4),
    s = new Float64Array(3)
  assert.ok(Number.isNaN(determinantMatrix4(m)))
  decomposeMatrix4(m, p, q, s)
  assert.equal(s[0], 1)
})

test('decomposeMatrix4: round-trip on a rigid pose (non-uniform scale, arbitrary rotation)', () => {
  const position = [4, -2, 7],
    quaternion = [0.1826, 0.3651, 0.5477, 0.7303], // deliberately unnormalised, near unit
    scale = [2, 0.5, 3]
  const n = Math.hypot(...quaternion)
  const q = quaternion.map((c) => c / n) as [number, number, number, number]
  const m = composeMatrix4(new Float64Array(16), position, q, scale)
  const p2 = new Float64Array(3),
    q2 = new Float64Array(4),
    s2 = new Float64Array(3)
  decomposeMatrix4(m, p2, q2, s2)
  assert.ok(
    [...p2].every((v, i) => nearly(v, position[i])),
    'position',
  )
  assert.ok(
    [...s2].every((v, i) => nearly(v, scale[i])),
    'scale',
  )
  const recompose = composeMatrix4(new Float64Array(16), p2, q2, s2)
  assert.ok(
    [...recompose].every((v, i) => nearly(v, m[i], 1e-6)),
    'recomposition without shear',
  )
})

test('decomposeMatrix4: negative scale on a single axis, carried by x, determinant of the same sign', () => {
  const m = composeMatrix4(new Float64Array(16), [0, 0, 0], [0, 0, 0, 1], [-2, 3, 4])
  const p = new Float64Array(3),
    q = new Float64Array(4),
    s = new Float64Array(3)
  decomposeMatrix4(m, p, q, s)
  assert.equal(Math.sign(s[0]), -1, 'x porte le signe')
  assert.ok(s[1] > 0 && s[2] > 0, 'y and z stay positive')
  assert.equal(Math.sign(s[0] * s[1] * s[2]), Math.sign(determinantMatrix4(m)))
})

test('decomposeMatrix4: zero scale on one axis keeps that axis unrotated, no NaN', () => {
  const m = composeMatrix4(new Float64Array(16), [1, 1, 1], [0, 0, 0, 1], [0, 2, 2])
  const p = new Float64Array(3),
    q = new Float64Array(4),
    s = new Float64Array(3)
  decomposeMatrix4(m, p, q, s)
  assert.deepEqual([...p], [1, 1, 1])
  assert.deepEqual([...s], [0, 2, 2])
  assert.deepEqual([...q], [0, 0, 0, 1], 'the zero axis is rebuilt from the other two')
  const h = Math.SQRT1_2
  const r = composeMatrix4(new Float64Array(16), [0, 0, 0], [0, 0, h, h], [0, 2, 2])
  decomposeMatrix4(r, p, q, s)
  for (const [i, v] of [0, 2, 2].entries()) assert.ok(Math.abs(s[i] - v) < 1e-12, 'scale kept')
  for (const [i, v] of [0, 0, h, h].entries())
    assert.ok(Math.abs(q[i] - v) < 1e-12, 'Z rotation kept')
})

test('basisMatrix4: columns u, v, n then the origin, last row exact, written at an offset', () => {
  const out = new Float64Array(32).fill(NaN)
  basisMatrix4(out, [1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12], 16)
  assert.ok([...out.subarray(0, 16)].every(Number.isNaN), 'nothing before the offset')
  assert.deepEqual([...out.subarray(16)], [1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0, 10, 11, 12, 1])
})

test('uniformScaleMatrix4: the diagonal scaled, the centre in the last column, the rest zero', () => {
  const out = uniformScaleMatrix4(new Float64Array(16).fill(NaN), 2.5, [7, 8, 9])
  assert.deepEqual([...out], [2.5, 0, 0, 0, 0, 2.5, 0, 0, 0, 0, 2.5, 0, 7, 8, 9, 1])
})
