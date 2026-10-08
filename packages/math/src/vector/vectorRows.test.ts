// vector.ts: one row of a transform, a dot against three numbers, the unit vector or zero, and the
// signed angle about an axis — each against the full form it is one part of, or an exact value.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  dotVector3,
  dotVector3Xyz,
  normalizeVector3,
  normalizeVector3OrZero,
  signedAngleVector3,
  transformDirectionRow,
  transformHomogeneousPoint,
  transformPointRow,
} from './vector.ts'
import { HALTON_SWEEP, haltonSpan } from '../sequence/sweep.fixture.ts'

const sweepVector = (i: number, lo: number, hi: number) => [
  haltonSpan(i, 2, lo, hi),
  haltonSpan(i, 3, lo, hi),
  haltonSpan(i, 5, lo, hi),
]

test('dotVector3Xyz is dotVector3 bit for bit, at an offset', () => {
  assert.equal(dotVector3Xyz([9, 1, 2, 3], 4, 5, 6, 1), 32)
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const a = sweepVector(i, -1e3, 1e3),
      b = sweepVector(HALTON_SWEEP + 1 - i, -10, 10)
    assert.ok(Object.is(dotVector3Xyz(a, b[0], b[1], b[2]), dotVector3(a, b)), `${i}`)
  }
})

test('transformPointRow and transformDirectionRow are the components of the full transform', () => {
  const m = Float64Array.from({ length: 20 }, (_, k) => Math.sin(k + 1) * (k + 1))
  const full = new Float64Array(4)
  for (let i = 1; i <= 256; i++) {
    const [x, y, z] = sweepVector(i, -50, 50)
    transformHomogeneousPoint(full, m, x, y, z)
    for (let row = 0; row < 4; row++) {
      assert.ok(Object.is(transformPointRow(m, row, x, y, z), full[row]), `point ${i}.${row}`)
      const direction = m[row] * x + m[4 + row] * y + m[8 + row] * z
      assert.ok(Object.is(transformDirectionRow(m, row, x, y, z), direction), `dir ${i}.${row}`)
    }
    // Read at an offset, the same matrix four numbers further.
    transformHomogeneousPoint(full, m.subarray(4), x, y, z)
    assert.ok(Object.is(transformPointRow(m, 2, x, y, z, 4), full[2]), `offset ${i}`)
  }
  // A translation alone: the point moves, the direction does not.
  const t = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 7, 8, 9, 1]
  assert.equal(transformPointRow(t, 1, 1, 2, 3), 10)
  assert.equal(transformDirectionRow(t, 1, 1, 2, 3), 2)
})

test('normalizeVector3OrZero: normalizeVector3 bits above the bound, zeros below, NaN through', () => {
  const out = new Float64Array(5),
    plain = new Float64Array(3)
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const v = sweepVector(i, -2, 2)
    normalizeVector3OrZero(out, v, 1e-8, 1)
    plain.set(v)
    normalizeVector3(plain)
    for (let k = 0; k < 3; k++) assert.ok(Object.is(out[1 + k], plain[k]), `${i}.${k}`)
  }
  // (1, 2, 2) has length 3 exactly.
  assert.deepEqual(
    [...normalizeVector3OrZero(new Float64Array(3), [1, 2, 2], 0)],
    [1 / 3, 2 / 3, 2 / 3],
  )
  // Squared length 1e-8 · 0.99 is below the bound, 1e-8 itself is not.
  const small = Math.sqrt(0.99e-8)
  assert.deepEqual([...normalizeVector3OrZero(new Float64Array(3), [small, 0, 0], 1e-8)], [0, 0, 0])
  assert.equal(normalizeVector3OrZero(new Float64Array(3), [1e-4, 0, 0], 1e-8)[0], 1)
  // `out` may be `v`, read at its offset.
  const same = Float64Array.of(5, 0, 0, -4)
  normalizeVector3OrZero(same, same, 1e-8, 1, 1)
  assert.deepEqual([...same], [5, 0, 0, -1])
  const nan = normalizeVector3OrZero(new Float64Array(3), [NaN, 1, 0], 1e-8)
  assert.ok(nan.every(Number.isNaN))
})

test('signedAngleVector3: a known turn, its sign by the axis, and the plain expression', () => {
  const up = [0, 0, 1],
    down = [0, 0, -1]
  for (const angle of [0.25, 1, 2.5, -0.75, -3]) {
    const a = [2, 0, 0],
      b = [3 * Math.cos(angle), 3 * Math.sin(angle), 0]
    assert.ok(Math.abs(signedAngleVector3(a, b, up) - angle) <= 8 * Number.EPSILON, `${angle}`)
    assert.ok(Math.abs(signedAngleVector3(a, b, down) + angle) <= 8 * Number.EPSILON, `-${angle}`)
  }
  // The expression it replaces: cross then dot with the axis, over the dot of the two.
  const old = (a: number[], b: number[], n: number[]) => {
    const cx = a[1] * b[2] - a[2] * b[1],
      cy = a[2] * b[0] - a[0] * b[2],
      cz = a[0] * b[1] - a[1] * b[0]
    return Math.atan2(cx * n[0] + cy * n[1] + cz * n[2], a[0] * b[0] + a[1] * b[1] + a[2] * b[2])
  }
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const a = sweepVector(i, -5, 5),
      b = sweepVector(HALTON_SWEEP + 1 - i, -5, 5),
      n = sweepVector(i + 17, -1, 1)
    assert.ok(Object.is(signedAngleVector3(a, b, n), old(a, b, n)), `${i}`)
  }
  const packed = [9, 1, 0, 0, 0, 1, 0, 0, 0, 1]
  assert.equal(signedAngleVector3(packed, packed, packed, 1, 4, 7), Math.PI / 2)
})
