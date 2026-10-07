import assert from 'node:assert/strict'
import test from 'node:test'
import {
  distanceSqVector3,
  distanceVector3,
  dotScalar3,
  dotVector3,
  length2,
  length3,
  normalizeVector2,
  normalizeVector3,
  plainLength3,
  transformAffinePointRowMajor,
} from './vector.ts'
import { hypot3 } from '../float/hypot.ts'

const bitsOf = (value: number) => new BigUint64Array(Float64Array.of(value).buffer)[0]

test('length3: Pythagorean quadruples are exact, a zero is +0 and a NaN stays NaN', () => {
  assert.equal(length3(3, 4, 12), 13)
  assert.equal(length3(1, 2, 2), 3)
  assert.equal(length3(-3, 4, -12), 13)
  assert.ok(Object.is(length3(-0, 0, -0), 0))
  assert.ok(Number.isNaN(length3(NaN, 1, 0)))
})

test('length3 is the plain root of the squares summed left to right, not Math.hypot', () => {
  // The triple of `page-codec-wasm/src/math_tests.rs`: `Math.hypot` rounds to …ac11, the plain
  // root one bit higher.
  const x = 0.4471859335899353,
    y = -0.1211518868803978,
    z = 0.4516414701938629
  assert.equal(bitsOf(hypot3(x, y, z)), 0x3fe4b46054c7ac11n)
  assert.equal(bitsOf(length3(x, y, z)), 0x3fe4b46054c7ac12n)
})

test("plainLength3 is the Rust twins' root: the band's bits, Infinity and 0 outside it", () => {
  const x = 0.4471859335899353,
    y = -0.1211518868803978,
    z = 0.4516414701938629
  assert.equal(bitsOf(plainLength3(x, y, z)), bitsOf(length3(x, y, z)))
  // Past the band the squares overflow, below it they underflow: `dot(a, a).sqrt()` in Rust.
  assert.equal(plainLength3(1e155, 0, 0), Infinity)
  assert.equal(length3(1e155, 0, 0), 1e155)
  assert.equal(plainLength3(1e-170, 0, 0), 0)
  assert.equal(length3(1e-170, 0, 0), 1e-170)
})

test("dotScalar3 sums dotVector3's terms in its order", () => {
  const a = [0.1, 1e16, -1e16],
    b = [3, 1, 1]
  // Left to right, 1e16 + (−1e16) cancels after 0.1·3: the terms' order shows in the last bits.
  assert.equal(dotScalar3(a[0], a[1], a[2], b[0], b[1], b[2]), dotVector3(a, b))
  assert.equal(dotScalar3(a[0], a[1], a[2], b[0], b[1], b[2]), 0)
  assert.equal(dotScalar3(1, 2, 3, 4, 5, 6), 32)
})

test('length2: Pythagorean triples are exact, a signed zero gives +0', () => {
  assert.equal(length2(3, 4), 5)
  assert.equal(length2(5, 12), 13)
  assert.ok(Object.is(length2(-0, 0), 0))
})

test('distanceSqVector3 and distanceVector3 read each point at its offset', () => {
  assert.equal(distanceSqVector3([1, 2, 3], [4, 6, 15]), 169)
  assert.equal(distanceVector3([1, 2, 3], [4, 6, 15]), 13)
  const a = [9, 9, 1, 2, 3],
    b = [9, 4, 6, 15]
  assert.equal(distanceSqVector3(a, b, 2, 1), 169)
  assert.equal(distanceVector3(a, b, 2, 1), 13)
  // `b − a` and `a − b` square to the same terms.
  assert.equal(distanceVector3(b, a, 1, 2), 13)
})

test('normalizeVector3: a quadruple scales to its exact thirds, zero stays zero, the offset holds', () => {
  const v = Float64Array.of(7, 1, 2, 2)
  normalizeVector3(v, 1)
  assert.deepEqual([...v], [7, 1 / 3, 2 / 3, 2 / 3])
  const zero = Float64Array.of(0, -0, 0)
  normalizeVector3(zero)
  assert.ok(Object.is(zero[0], 0) && Object.is(zero[1], -0) && Object.is(zero[2], 0))
})

test('normalizeVector2: axis vectors become unit, zero stays, (3, 4) within an ulp of (0.6, 0.8)', () => {
  const v = Float64Array.of(0, 5)
  normalizeVector2(v)
  assert.deepEqual([...v], [0, 1])
  v.set([-2, 0])
  normalizeVector2(v)
  assert.deepEqual([...v], [-1, 0])
  v.set([0, 0])
  normalizeVector2(v)
  assert.deepEqual([...v], [0, 0])
  const off = Float64Array.of(1, 3, 4)
  normalizeVector2(off, 1)
  assert.equal(off[0], 1)
  assert.ok(Math.abs(off[1] - 0.6) <= Number.EPSILON * 0.6, String(off[1]))
  assert.ok(Math.abs(off[2] - 0.8) <= Number.EPSILON * 0.8, String(off[2]))
})

test('transformAffinePointRowMajor: three rows of four read at an offset, written at an offset', () => {
  const m = [-1, -1, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  const out = new Float64Array(5)
  transformAffinePointRowMajor(out, m, 1, -1, 2, 2, 3)
  assert.deepEqual([...out], [0, 0, 9, 21, 33])
})

test('transformAffinePointRowMajor: a single-precision output rounds each row once', () => {
  const m = [0.1, 0.2, 0.3, 0.7, 1 / 3, 1 / 7, 1 / 9, 1e-9, 0.11, 0.13, 0.17, 1e8]
  const x = 1.1,
    y = -2.3,
    z = 3.7
  const out = new Float32Array(3)
  transformAffinePointRowMajor(out, m, x, y, z)
  for (let r = 0; r < 3; r++) {
    const row = m.slice(4 * r, 4 * r + 4)
    const exact = row[0] * x + row[1] * y + row[2] * z + row[3]
    assert.ok(Object.is(out[r], Math.fround(exact)), `row ${r}`)
  }
})
