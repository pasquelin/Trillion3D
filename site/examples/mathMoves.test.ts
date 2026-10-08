import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEG2RAD } from '../../packages/math/src/constants.ts'
import {
  HALTON_SWEEP,
  assertSameFloat32,
  edgeValues,
  haltonSpan,
} from '../../packages/math/src/sequence/sweep.fixture.ts'
import { math } from '../../packages/sdk-core/src/world/math/index.ts'

/** The pages' angle, the field of view, the gradient and the vectors, each against the expression
 *  the page wrote before it read `math`. */
const sweep = (lo: number, hi: number, base = 2) =>
  [...Array(HALTON_SWEEP)].map((_, i) => haltonSpan(i + 1, base, lo, hi)).concat(edgeValues(lo, hi))

test('degToRad: (x·π)/180 and (x·π)/360 round to the float32 of x·DEG2RAD, and of what reads them', () => {
  for (const x of sweep(-720, 720)) {
    const oldDeg = (x * Math.PI) / 180,
      oldHalf = (x * Math.PI) / 360,
      oldOfHalf = ((x / 2) * Math.PI) / 180
    for (const [old, now] of [
      [oldDeg, math.degToRad(x)],
      [oldHalf, math.degToRad(x / 2)],
      [oldOfHalf, math.degToRad(x / 2)],
    ]) {
      assertSameFloat32(old, now, `angle of ${x}`)
      assertSameFloat32(Math.sin(old), Math.sin(now), `sin of ${x}`)
      assertSameFloat32(Math.cos(old), Math.cos(now), `cos of ${x}`)
      assertSameFloat32(Math.tan(old), Math.tan(now), `tan of ${x}`)
    }
  }
})

test('the one degree the town page multiplies by is Math.PI / 180', () => {
  assert.ok(Object.is(math.degToRad(1), Math.PI / 180))
  assert.ok(Object.is(DEG2RAD, Math.PI / 180))
})

test('cross and dot through math.vector3 are the pages’ own products, bit for bit', () => {
  const a = math.vector3(),
    b = math.vector3()
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const u = [haltonSpan(i, 2, -9, 9), haltonSpan(i, 3, -9, 9), haltonSpan(i, 5, -9, 9)]
    const v = [haltonSpan(i, 7, -9, 9), haltonSpan(i, 11, -9, 9), haltonSpan(i, 13, -9, 9)]
    const oldCross = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ]
    assert.deepEqual(a.fromArray(u).cross(b.fromArray(v)).toArray(), oldCross)
    assert.ok(
      Object.is(a.fromArray(u).dot(b.fromArray(v)), u[0] * v[0] + u[1] * v[1] + u[2] * v[2]),
    )
  }
})

test('normalize reaches the float32 of v / (Math.hypot(v) || 1), whatever the length', () => {
  const unit = math.vector3()
  const oldUnit = (v: number[]) => {
    const l = Math.hypot(...v) || 1
    return [v[0] / l, v[1] / l, v[2] / l]
  }
  for (const [lo, hi] of [
    [-1e-6, 1e-6],
    [-1, 1],
    [-1e3, 1e3],
    [-1e6, 1e6],
  ])
    for (let i = 1; i <= HALTON_SWEEP; i++) {
      const v = [haltonSpan(i, 2, lo, hi), haltonSpan(i, 3, lo, hi), haltonSpan(i, 5, lo, hi)]
      const now = unit.fromArray(v).normalize()
      oldUnit(v).forEach((x, k) => assertSameFloat32(x, now.toArray()[k], `${v} axis ${k}`))
    }
  assert.deepEqual(unit.fromArray([0, 0, 0]).normalize().toArray(), [0, 0, 0])
  // The negated gradient of the blob page: the sign rides through the product.
  const [gx, gy, gz] = [0.25, -0.5, 0.125]
  const old = oldUnit([-gx, -gy, -gz])
  const now = unit.set(-gx, -gy, -gz).normalize().toArray()
  old.forEach((x, k) => assertSameFloat32(x, now[k], 'negated gradient'))
})

// The blob page's `clamp01` was Math.min(1, Math.max(0, v)); math.clamp compares instead. They
// differ only in the sign of a zero (-0 stays -0) and the field is a product read against a level,
// where either zero compares equal.
test('math.clamp(v, 0, 1) takes the values of clamp01, up to the sign of zero', () => {
  for (const v of [...sweep(-3, 4), NaN, Infinity, -Infinity]) {
    const old = Math.min(1, Math.max(0, v)),
      now = math.clamp(v, 0, 1)
    assert.ok(old === now || (Number.isNaN(old) && Number.isNaN(now)), `clamp of ${v}`)
  }
})

/** Directions from tiny to large, the spans the sweeps below draw each component from. */
const SPANS = [
  [-1e-6, 1e-6],
  [-1, 1],
  [-1e3, 1e3],
  [-1e6, 1e6],
]

// The roller coaster's and the temple's `unit(a)` was `a · (1 / Math.hypot(...a))`; it is now
// `math.vector3().fromArray(a).normalize()`, `a · (1 / (length3 || 1))`. A zero vector, which
// came out NaN, comes out zero; neither page aims along one.
test('unit() through normalize reaches the float32 of a · (1 / Math.hypot(a))', () => {
  const direction = math.vector3()
  for (const [lo, hi] of SPANS)
    for (let i = 1; i <= HALTON_SWEEP; i++) {
      const v = [haltonSpan(i, 2, lo, hi), haltonSpan(i, 3, lo, hi), haltonSpan(i, 5, lo, hi)]
      const inverse = 1 / Math.hypot(...v),
        now = direction.fromArray(v).normalize().toArray()
      v.forEach((x, k) => assertSameFloat32(x * inverse, now[k], `${v} axis ${k}`))
    }
})

// The temple's level gaze was `look / (Math.hypot(look.x, look.z) || 1)`, now
// `math.vector2(look.x, look.z).normalize()`; the town's aim and the framing's polar turn divide
// by `Math.hypot(x, y) || 1`, now `math.vector2(x, y).length() || 1`.
test('the level direction and its length through math.vector2 reach the float32 of Math.hypot', () => {
  const level = math.vector2()
  for (const [lo, hi] of SPANS)
    for (let i = 1; i <= HALTON_SWEEP; i++) {
      const [x, y] = [haltonSpan(i, 2, lo, hi), haltonSpan(i, 3, lo, hi)]
      const scale = haltonSpan(i, 5, -3, 3)
      const old = Math.hypot(x, y) || 1,
        now = level.set(x, y).length() || 1
      assertSameFloat32((scale * x) / old, (scale * x) / now, `${x}, ${y} scaled`)
      assertSameFloat32((scale * y) / old, (scale * y) / now, `${x}, ${y} scaled`)
      level.set(x, y).normalize()
      assertSameFloat32(x / old, level.x, `${x}, ${y} x`)
      assertSameFloat32(y / old, level.y, `${x}, ${y} y`)
    }
  assert.deepEqual(level.set(0, 0).normalize().toArray(), [0, 0])
})
