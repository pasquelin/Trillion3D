import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEG2RAD, RAD2DEG, TAU } from '../../packages/math/src/constants.ts'
import { perspectiveSlope } from '../../packages/math/src/projection/camera.ts'
import { clamp } from '../../packages/math/src/scalar/reals.ts'
import { axisAngleQuaternion } from '../../packages/math/src/quaternion/quaternion.ts'
import { mulberry32 } from '../../packages/math/src/sequence/random.ts'
import {
  HALTON_SWEEP,
  edgeValues,
  haltonSpan,
} from '../../packages/math/src/sequence/sweep.fixture.ts'
import { length2, length3 } from '../../packages/math/src/vector/vector.ts'
import { slab } from './lighting/lightTileCity.ts'
import { ulpBetween } from '../core/ulp.ts'

// The bench's figures against the expressions they were written with. A bench number never
// reaches a pixel (proof (a)): what is asserted is that the new reading is the old one to a few
// units in the last place of a double (`ulpBetween`), so a posted figure, rounded for a report, is
// the same.

test('length3 and length2 read the lengths Math.hypot did, to two units in the last place', () => {
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const [x, y, z] = [
      haltonSpan(i, 2, -1e3, 1e3),
      haltonSpan(i, 3, -1e3, 1e3),
      haltonSpan(i, 5, -1e3, 1e3),
    ]
    assert.ok(ulpBetween(Math.hypot(x, y, z), length3(x, y, z)) <= 2, `length3 of ${x}, ${y}, ${z}`)
    assert.ok(ulpBetween(Math.hypot(x, y), length2(x, y)) <= 2, `length2 of ${x}, ${y}`)
  }
  for (const x of edgeValues(-1e3, 1e3)) assert.ok(ulpBetween(Math.hypot(x, 1), length2(x, 1)) <= 2)
})

test('the page-quantization angle, from the dot of two unit normals, keeps its degrees', () => {
  for (const dot of [
    ...edgeValues(-1.5, 1.5),
    ...Array.from({ length: HALTON_SWEEP }, (_, i) => haltonSpan(i + 1, 2, -1.5, 1.5)),
  ]) {
    const old = (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI,
      now = Math.acos(clamp(dot, -1, 1)) * RAD2DEG
    assert.ok(ulpBetween(old, now) <= 4 || Math.abs(old - now) < 1e-13, `angle of dot ${dot}`)
  }
})

test('the light-tile views turn by the same radians as before', () => {
  for (const degrees of [30, 2, 45, 15, 1, 20, 5, 60, 8, -30, -2])
    assert.ok(ulpBetween((degrees * Math.PI) / 180, degrees * DEG2RAD) <= 1, `${degrees} degrees`)
})

test("the witness's LOD reads its camera's own tangent, the old one to four units in the last place", () => {
  // The witness projects with `tan(DEG2RAD · 0.5 · fov)`, which is `perspectiveSlope(fov)`; the
  // old `tan((fov · π) / 360)` rounds its angle apart, which the tangent magnifies toward 180°.
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const fov = haltonSpan(i, 2, 1, 179)
    assert.ok(Object.is(perspectiveSlope(fov), Math.tan(DEG2RAD * 0.5 * fov)), `fov ${fov}`)
    if (fov <= 120)
      assert.ok(
        ulpBetween(Math.tan((fov * Math.PI) / 360), perspectiveSlope(fov)) <= 4,
        `fov ${fov}`,
      )
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
    assert.ok(ulpBetween(n0, n1) <= 2 && ulpBetween(f0, f1) <= 2, `ray ${i} enters and leaves`)
  }
  assert.ok(hits > HALTON_SWEEP / 2, `${hits} rays hit`)
})

test("the aerial props' turns about +Y are axisAngleQuaternion's, bit for bit", () => {
  // The draw `r` is a whole number over 2³²: `r · TAU` is `2 · (r · π)` exactly, halved exactly.
  const random = mulberry32(7),
    q = new Float64Array(4)
  for (const r of [0, 1 - 2 ** -32, ...Array.from({ length: HALTON_SWEEP }, random)]) {
    const turn = r * Math.PI,
      old = [0, Math.sin(turn), 0, Math.cos(turn)]
    axisAngleQuaternion(q, [0, 1, 0], r * TAU)
    for (let k = 0; k < 4; k++) assert.ok(Object.is(q[k], old[k]), `draw ${r}`)
  }
})
