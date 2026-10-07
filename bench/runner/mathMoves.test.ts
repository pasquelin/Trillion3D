import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEG2RAD, MIB, RAD2DEG } from '../../packages/math/src/constants.ts'
import { quantile } from '../../packages/math/src/scalar/quantile.ts'
import { clamp } from '../../packages/math/src/scalar/reals.ts'
import {
  HALTON_SWEEP,
  edgeValues,
  haltonSpan,
} from '../../packages/math/src/sequence/sweep.fixture.ts'
import { length2, length3 } from '../../packages/math/src/vector/vector.ts'

/** The bench's figures against the expressions they were written with. A bench number never
 *  reaches a pixel (proof (a)): what is asserted is that the new reading is the old one to
 *  two units in the last place of a double, so a posted figure, rounded for a report, is the same. */
const ulps = (old: number, now: number) =>
  old === now ? 0 : Math.abs(old - now) / (Math.abs(old) * Number.EPSILON)

test('length3 and length2 read the lengths Math.hypot did, to two units in the last place', () => {
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const [x, y, z] = [
      haltonSpan(i, 2, -1e3, 1e3),
      haltonSpan(i, 3, -1e3, 1e3),
      haltonSpan(i, 5, -1e3, 1e3),
    ]
    assert.ok(ulps(Math.hypot(x, y, z), length3(x, y, z)) <= 2, `length3 of ${x}, ${y}, ${z}`)
    assert.ok(ulps(Math.hypot(x, y), length2(x, y)) <= 2, `length2 of ${x}, ${y}`)
  }
  for (const x of edgeValues(-1e3, 1e3)) assert.ok(ulps(Math.hypot(x, 1), length2(x, 1)) <= 2)
})

test('the page-quantization angle, from the dot of two unit normals, keeps its degrees', () => {
  for (const dot of [
    ...edgeValues(-1.5, 1.5),
    ...Array.from({ length: HALTON_SWEEP }, (_, i) => haltonSpan(i + 1, 2, -1.5, 1.5)),
  ]) {
    const old = (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI,
      now = Math.acos(clamp(dot, -1, 1)) * RAD2DEG
    assert.ok(ulps(old, now) <= 4 || Math.abs(old - now) < 1e-13, `angle of dot ${dot}`)
  }
})

test('the light-tile views turn by the same radians as before', () => {
  for (const degrees of [30, 2, 45, 15, 1, 20, 5, 60, 8, -30, -2])
    assert.ok(ulps((degrees * Math.PI) / 180, degrees * DEG2RAD) <= 1, `${degrees} degrees`)
})

test('the byte units are the exact powers of two they were written as', () => {
  assert.equal(MIB, 1024 * 1024)
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const value = haltonSpan(i, 2, 0.001, 4096)
    assert.ok(Object.is(value * 1024 * 1024, value * MIB))
    assert.ok(Object.is(value / 1048576, value / MIB))
    assert.ok(Object.is(value / (1024 * 1024), value / MIB))
  }
})

// The campaign's error percentiles and the worker bench's quartiles each read `floor(q n)`; the
// engine's nearest rank is `ceil(q n) - 1`. They are the same index when `q n` is not a whole
// number, and the engine's is the one before when it is (the 95th of twenty: the 19th, not the
// 20th), the usual definition of a percentile.
test('quantile is the nearest rank the benches now read', () => {
  const sorted = Array.from({ length: 20 }, (_, i) => i)
  assert.equal(quantile(sorted, 0.95), 18)
  assert.equal(quantile(sorted.slice(0, 19), 0.95), 18)
  assert.equal(quantile(sorted.slice(0, 19), 0.5), 9)
  assert.equal(quantile([3, 1, 2].sort(), 0.5), 2)
})
