import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEG2RAD,
  HALF_PI,
  MIB,
  QUARTER_PI,
  RAD2DEG,
  TAU,
} from '../../packages/math/src/constants.ts'
import { perspectiveSlope } from '../../packages/math/src/projection/camera.ts'
import { quantile } from '../../packages/math/src/scalar/quantile.ts'
import { clamp } from '../../packages/math/src/scalar/reals.ts'
import {
  HALTON_SWEEP,
  edgeValues,
  haltonSpan,
} from '../../packages/math/src/sequence/sweep.fixture.ts'
import { length2, length3 } from '../../packages/math/src/vector/vector.ts'
import { slab } from './lighting/lightTileCity.ts'

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

test('the turns the bench walks are the radians they were written as, bit for bit', () => {
  // A power of two scales without rounding: `x · π · 2` is `x · TAU`, `(x · π) / 4` is
  // `x · QUARTER_PI`, `(x · π) · 4` is `x · TAU · 2`, `(2π) / 3` and `(4π) / 3` are `TAU / 3`
  // and `(2 · TAU) / 3`.
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const x = haltonSpan(i, 2, -1e3, 1e3)
    assert.ok(Object.is(x * Math.PI * 2, x * TAU), `${x} turns`)
    assert.ok(Object.is((x * Math.PI) / 4, x * QUARTER_PI), `${x} eighths`)
    assert.ok(Object.is(x * Math.PI * 4, x * TAU * 2), `${x} half turns`)
    assert.ok(Object.is(x * (Math.PI / 2), x * HALF_PI), `${x} quarters`)
  }
  assert.ok(Object.is((2 * Math.PI) / 3, TAU / 3) && Object.is((4 * Math.PI) / 3, (2 * TAU) / 3))
})

test("the witness's LOD reads its camera's own tangent, the old one to four units in the last place", () => {
  // The witness projects with `tan(DEG2RAD · 0.5 · fov)`, which is `perspectiveSlope(fov)`; the
  // old `tan((fov · π) / 360)` rounds its angle apart, which the tangent magnifies toward 180°.
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const fov = haltonSpan(i, 2, 1, 179)
    assert.ok(Object.is(perspectiveSlope(fov), Math.tan(DEG2RAD * 0.5 * fov)), `fov ${fov}`)
    if (fov <= 120)
      assert.ok(ulps(Math.tan((fov * Math.PI) / 360), perspectiveSlope(fov)) <= 4, `fov ${fov}`)
  }
})

/** The light tiles' slab as it was written: each axis cut by `(plane − o) · (1 / d)`. */
function oldSlab(o: number[], d: number[], lo: number[], hi: number[]) {
  let near = -Infinity,
    far = Infinity
  for (let a = 0; a < 3; a++) {
    const inv = 1 / d[a],
      t1 = (lo[a] - o[a]) * inv,
      t2 = (hi[a] - o[a]) * inv
    near = Math.max(near, Math.min(t1, t2))
    far = Math.min(far, Math.max(t1, t2))
  }
  return [near, far]
}

test('the light tiles cut their rays by the engine slab test, as before to two units in the last place', () => {
  type V = [number, number, number]
  let hits = 0
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const o: V = [haltonSpan(i, 2, -90, 90), haltonSpan(i, 3, -5, 95), haltonSpan(i, 5, -90, 90)]
    const lo: V = [haltonSpan(i, 17, -60, 0), 0, haltonSpan(i, 19, -60, 0)]
    const hi: V = [lo[0] + haltonSpan(i, 23, 1, 60), haltonSpan(i, 29, 1, 90), lo[2] + 12]
    // Aimed at a point of the box grown by a fifth on each side: most rays hit, some graze or miss.
    const d = [7, 11, 13].map((base, a) => {
      const reach = (hi[a] - lo[a]) * 0.2
      return haltonSpan(i, base, lo[a] - reach, hi[a] + reach) - o[a]
    }) as V
    if (d.includes(0)) continue
    const [n0, f0] = oldSlab(o, d, lo, hi),
      [n1, f1] = slab(o, d, lo, hi)
    // A ray that grazes the box, entry and exit within rounding, may change side; none other.
    if (Math.abs(f0 - n0) <= 4 * Number.EPSILON * Math.max(Math.abs(n0), Math.abs(f0))) continue
    assert.equal(n1 <= f1, n0 <= f0, `ray ${i} hits as before`)
    if (n0 > f0) continue
    hits++
    assert.ok(ulps(n0, n1) <= 2 && ulps(f0, f1) <= 2, `ray ${i} enters and leaves`)
  }
  assert.ok(hits > HALTON_SWEEP / 2, `${hits} rays hit`)
})
