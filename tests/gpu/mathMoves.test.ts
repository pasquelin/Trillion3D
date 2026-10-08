// The GPU proofs' scene numbers, now read from packages/math, against the expressions they were
// written as. Every one is the same double: a tangent of the same angle, a power of two that
// scales without rounding, a length whose sum of squares is exact on these inputs. The proofs
// draw the same scenes; the helpers that normalise a draw or a model normal read the same f32 words.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEG2RAD, HALF_PI, RAD2DEG, TAU } from '../../packages/math/src/constants.ts'
import { perspectiveSlope } from '../../packages/math/src/projection/camera.ts'
import { length2, length3 } from '../../packages/math/src/vector/vector.ts'
import { distance, resolveRandom } from './lighting/resolveCases.ts'
import {
  angleBetween,
  inverseTransposeBefore,
  inverseTransposeShipped,
  unit,
} from './math/inverseTransposeF32.ts'
import { CASES, COLLAPSED, FLATTENED, TINY_REGULAR } from './math/normalTransformCases.ts'

test('the cameras open the same tangent through perspectiveSlope', () => {
  // `facingWorld.ts` (50°), `computeRasterScene.ts` and `waterCostScene.ts` (55°).
  assert.ok(Object.is(perspectiveSlope(50), Math.tan((50 * Math.PI) / 360)))
  assert.ok(Object.is(perspectiveSlope(55), Math.tan((55 / 2) * (Math.PI / 180))))
  assert.ok(Object.is(perspectiveSlope(55), Math.tan((55 * Math.PI) / 360)))
})

test('the turned objects and lights turn by the same radians', () => {
  assert.ok(Object.is(60 * DEG2RAD, Math.PI / 3))
  assert.ok(Object.is(30 * DEG2RAD, Math.PI / 6))
  assert.ok(Object.is(HALF_PI, Math.PI / 2))
  assert.ok(Object.is(RAD2DEG, 180 / Math.PI))
  for (const degrees of [75, 80, 84, 88])
    assert.ok(Object.is(-degrees * DEG2RAD, (-degrees * Math.PI) / 180), `${degrees}°`)
  // A power of two scales without rounding: the ring of lights, the water's swing.
  for (let i = 0; i <= 4096; i++) {
    assert.ok(Object.is((i / 64) * TAU, (i / 64) * Math.PI * 2), `light ${i}`)
    assert.ok(Object.is((i * TAU) / 60, (i * Math.PI) / 30), `frame ${i}`)
  }
})

test("the moving proxy's rays keep their lengths", () => {
  assert.ok(Object.is(length2(1, 0.05), Math.hypot(1, 0.05)))
  assert.ok(Object.is(length3(0.3, 0.2, 1), Math.hypot(0.3, 0.2, 1)))
})

/** How far `now` lies from `old`, in units of the last place of `old`. */
const ulps = (old: number, now: number) =>
  old === now ? 0 : Math.abs(old - now) / (Math.abs(old) * Number.EPSILON)

test('the resolve proofs draw the same f32 unit vectors, and their distances within two ulps', () => {
  // The vectors reach the GPU as f32: `x / Math.hypot(...v)` and the length rule's normalise give
  // the same f32 words. A distance stays on the CPU, where it picks the lights a point reaches.
  for (const seed of [849, 1249, 1471]) {
    const { vector, unit: drawn } = resolveRandom(seed)
    for (let i = 0; i < 4096; i++) {
      const v = vector(1),
        p = vector(1),
        now = drawn(v),
        root = Math.hypot(...v)
      v.forEach((x, k) => assert.ok(Object.is(Math.fround(x / root), Math.fround(now[k]))))
      const old = Math.hypot(v[0] - p[0], v[1] - p[1], v[2] - p[2])
      assert.ok(ulps(old, distance(v, p)) <= 2, `seed ${seed}, draw ${i}`)
    }
  }
})

test("the normal model's f32 unit vectors are the same, its angles within two ulps", () => {
  // The model normalises in f32 by a double length: the length rule's root and `Math.hypot` give
  // the same f32 quotient on every vector the cases normalise; the angle is read against degrees.
  const f = Math.fround
  for (const c of [...CASES, ...FLATTENED, ...COLLAPSED, TINY_REGULAR]) {
    const w = c.world,
      columns: [number, number, number][] = [0, 4, 8].map((at) => [w[at], w[at + 1], w[at + 2]])
    const shipped = inverseTransposeShipped(columns, c.normal),
      before = inverseTransposeBefore(columns, c.normal)
    for (const v of [shipped, before, c.normal]) {
      const root = Math.hypot(...v)
      if (!(root > 0)) continue
      const now = unit(v)
      v.forEach((x, k) => assert.ok(Object.is(f(x / root), now[k]), `${c.name}`))
      const [a, b] = [v, c.normal],
        cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
      const old = Math.atan2(Math.hypot(...cross), a[0] * b[0] + a[1] * b[1] + a[2] * b[2])
      assert.ok(ulps(old, angleBetween(a, b)) <= 2, `${c.name}`)
    }
  }
})
