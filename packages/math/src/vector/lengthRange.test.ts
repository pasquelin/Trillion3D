// The length rule's range (docs/MATHS.md "Lengths"): the plain root wherever the sum of squares is
// a normal finite double, `hypot` outside, so a length and a normalise hold at any magnitude.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  distanceVector3,
  length2,
  length3,
  NORMAL_SQUARES,
  normalizeVector2,
  normalizeVector3,
} from './vector.ts'
import { lengthQuaternion } from '../quaternion/quaternion.ts'
import { hypot2, hypot3, hypot4 } from '../float/hypot.ts'
import { halton } from '../sequence/halton.ts'

const N = 4096
const same = (a: number, b: number, what: string) =>
  assert.ok(Object.is(a, b), `${what}: ${a} ${b}`)
/** The roots the rule replaced, the squares summed left to right. */
const plain3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z)
const plain2 = (x: number, y: number) => Math.sqrt(x * x + y * y)

test('inside the normal band the rule is the plain root to the bit, Halton sweep and edges', () => {
  let swept = 0
  for (let i = 1; i <= N; i++) {
    // Magnitudes from 1e-140 to 1e150, every sign: the sums all fall in the band.
    const scale = 10 ** (290 * halton(i, 7) - 140)
    const [x, y, z] = [2, 3, 5].map((base) => scale * (2 * halton(i, base) - 1))
    if (!(x * x + y * y + z * z >= NORMAL_SQUARES)) continue
    swept++
    same(length3(x, y, z), plain3(x, y, z), `length3 ${x} ${y} ${z}`)
    same(length2(x, y), plain2(x, y), `length2 ${x} ${y}`)
    same(distanceVector3([x, y, z], [z, x, y]), plain3(x - z, y - x, z - y), `distance ${i}`)
    const q = [x, y, z, x]
    same(lengthQuaternion(q), Math.sqrt(x * x + y * y + z * z + x * x), `quaternion ${i}`)
  }
  assert.ok(swept > N - 8, `${swept} points in the band`)
  // The band's edges: its least sum, 2^-969, and the greatest finite one.
  const low = 2 ** -485,
    high = Math.sqrt(Number.MAX_VALUE) * (1 - 2 ** -52)
  same(length2(low, low), plain2(low, low), 'least sum')
  same(length3(low, low, 0), plain3(low, low, 0), 'least sum, three terms')
  same(length3(high, 0, 0), plain3(high, 0, 0), 'greatest sum')
  same(length2(high, 0), plain2(high, 0), 'greatest sum, plane')
  // Just outside: `hypot`, here the exact root the plain sum loses.
  same(length2(low, 0), hypot2(low, 0), 'below the band')
  same(length3(high, high, 0), hypot3(high, high, 0), 'past the band')
  assert.ok(Number.isFinite(length3(high, high, 0)) && plain3(high, high, 0) === Infinity)
})

/** The unit vector `normalize` makes of `v`, against the direction `u` it must point along. */
function assertUnit(v: number[], u: number[], what: string) {
  const out = Float64Array.from(v)
  if (v.length === 3) normalizeVector3(out)
  else normalizeVector2(out)
  u.forEach((c, k) => assert.ok(Math.abs(out[k] - c) <= 4e-16, `${what} [${k}]: ${out[k]}`))
}

test('long and tiny vectors normalise to unit ones: axes, 3-4-5 directions, any sign', () => {
  for (const c of [1e200, 1e155, 1e-163, 1e-170, 1e-310, 5e-324, Number.MAX_VALUE]) {
    for (const s of [1, -1]) {
      assertUnit([s * c, 0, 0], [s, 0, 0], `axis x ${s * c}`)
      assertUnit([0, s * c, 0], [0, s, 0], `axis y ${s * c}`)
      assertUnit([0, 0, s * c], [0, 0, s], `axis z ${s * c}`)
      assertUnit([s * c, 0], [s, 0], `wave x ${s * c}`)
      if (c > 1e-300 && c < 1e300) {
        assertUnit([3 * c, 0, -4 * s * c], [0.6, 0, -0.8 * s], `3-4-5 ${s * c}`)
        assertUnit([3 * c, 4 * s * c], [0.6, 0.8 * s], `wave 3-4 ${s * c}`)
        same(length3(2 * c, -c, 2 * s * c), hypot3(2 * c, -c, 2 * s * c), `length ${c}`)
        same(lengthQuaternion([c, c, -c, c]), hypot4(c, c, -c, c), `quaternion ${c}`)
        assert.ok(Math.abs(length3(2 * c, -c, 2 * s * c) / (3 * c) - 1) < 4e-16, `exact ${c}`)
      }
    }
  }
})

test('a zero length is +0, a NaN component NaN, an infinite one Infinity', () => {
  same(length3(0, -0, 0), 0, 'zero')
  same(length2(-0, -0), 0, 'zero, plane')
  same(lengthQuaternion([0, 0, -0, 0]), 0, 'zero quaternion')
  for (const v of [
    [NaN, 0, 0],
    [1e200, NaN, 0],
    [0, 1e-170, NaN],
    [Infinity, NaN, 0],
  ]) {
    assert.ok(Number.isNaN(length3(v[0], v[1], v[2])), `${v}`)
    assert.ok(Number.isNaN(length2(v[0], v[1] + v[2])), `${v}, plane`)
  }
  same(length3(Infinity, 1, 0), Infinity, 'infinite')
  same(length2(-Infinity, 1e-170), Infinity, 'infinite, plane')
  // A zero vector stays zero; a NaN one stays NaN.
  const zero = Float64Array.of(0, -0, 0),
    nan = Float64Array.of(NaN, 1, 0)
  normalizeVector3(zero)
  normalizeVector3(nan)
  assert.deepEqual([...zero], [0, -0, 0])
  assert.ok(Number.isNaN(nan[0]) && nan[1] === 1)
})
