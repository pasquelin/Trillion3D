// The triangle, plane and ray declarations of the maths library
// (`packages/math/src/wgsl/geometry.ts`), their shipped text run in JavaScript against the
// processor's twins — the frustum's box test, the slab cut — and independent references.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { lcg } from '../hiz/buildTranscripts.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import {
  boxBehindPlane,
  faceNormal,
  rayBoxEntry,
  rayInverseDirection,
  rayTriangleDistance,
  sinFromCos,
  sinFromCosUnclamped,
  sphereBehindPlane,
  vectorRejection,
} from '../../../../math/src/wgsl/geometry.ts'
import { frustumExcludesBox } from '../../../../math/src/geometry/frustum/box.ts'
import { slabCut } from '../../../../math/src/geometry/slab.ts'

type V = number[]
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub = (a: V, b: V) => a.map((x, i) => x - b[i])
const near = (a: number, b: number, what: string) =>
  assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${what}: ${a} vs ${b}`)
/** `n` draws of the seeded sequence, in [-1, 1). */
const take = (rand: () => number, n: number) => Array.from({ length: n }, () => 2 * rand() - 1)

const run = shaderRun<Record<string, (...args: never[]) => never>>(
  wgslModule(
    faceNormal,
    vectorRejection,
    sinFromCos,
    sinFromCosUnclamped,
    boxBehindPlane,
    sphereBehindPlane,
    rayInverseDirection,
    rayBoxEntry,
    rayTriangleDistance,
  ),
  [
    'faceNormal',
    'vectorRejection',
    'sinFromCos',
    'sinFromCosUnclamped',
    'planeDistance',
    'boxPositiveVertex',
    'boxPlaneDistance',
    'boxBehindPlane',
    'sphereBehindPlane',
    'rayInverseDirection',
    'rayBoxEntry',
    'rayTriangleDistance',
  ],
  {},
) as unknown as Record<string, (...args: unknown[]) => unknown>

test('the face normal is across both edges, twice the area long', () => {
  const g = lcg(7)
  for (let i = 0; i < 50; i++) {
    const [p0, p1, p2] = [take(g, 3), take(g, 3), take(g, 3)]
    const n = run.faceNormal(p0, p1, p2) as V
    near(dot(n, sub(p1, p0)), 0, 'edge 1')
    near(dot(n, sub(p2, p0)), 0, 'edge 2')
    const [a, b] = [sub(p1, p0), sub(p2, p0)]
    near(dot(n, n), dot(a, a) * dot(b, b) - dot(a, b) ** 2, 'length² = (2·area)²')
  }
})

test('the rejection is across the normal and leaves v along it', () => {
  const g = lcg(11)
  for (let i = 0; i < 50; i++) {
    const v = take(g, 3),
      raw = take(g, 3),
      N = raw.map((x) => x / Math.sqrt(dot(raw, raw)))
    const t = run.vectorRejection(v, N) as V
    near(dot(t, N), 0, 'across')
    near(dot(sub(v, t), sub(v, t)), dot(v, N) ** 2, 'what remains is along N')
  }
})

test('the sine from the cosine is the sine of its angle; the floored one is 0 past ±1', () => {
  for (let a = 0; a <= Math.PI; a += Math.PI / 64) {
    near(run.sinFromCos(Math.cos(a)) as number, Math.sin(a), `floored ${a}`)
    near(run.sinFromCosUnclamped(Math.cos(a)) as number, Math.sin(a), `unfloored ${a}`)
  }
  assert.equal(run.sinFromCos(1 + 2 ** -20), 0)
  assert.ok(Number.isNaN(run.sinFromCosUnclamped(1 + 2 ** -20)))
})

test('a box behind a plane is what the frustum test culls; a sphere, by its centre and radius', () => {
  const g = lcg(3)
  // Five planes that keep everything: the verdict is the first plane's.
  const keepAll = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]
  let culled = 0
  for (let i = 0; i < 400; i++) {
    const plane = take(g, 4)
    const a = take(g, 3),
      b = take(g, 3)
    const bmin = a.map((x, k) => Math.min(x, b[k])),
      bmax = a.map((x, k) => Math.max(x, b[k]))
    const twin = frustumExcludesBox(
      Float64Array.from([...plane, ...keepAll]),
      bmin[0],
      bmin[1],
      bmin[2],
      bmax[0],
      bmax[1],
      bmax[2],
    )
    assert.equal(run.boxBehindPlane(plane, bmin, bmax), twin, `box ${i}`)
    culled += Number(twin)
    const length = Math.sqrt(dot(plane, plane))
    const unit = plane.map((x) => x / length)
    const centre = take(g, 3),
      radius = Math.abs(2 * g() - 1)
    assert.equal(run.sphereBehindPlane(unit, centre, radius), dot(unit, centre) + unit[3] < -radius)
  }
  assert.ok(culled > 50 && culled < 350, `both verdicts met: ${culled}`)
})

test('the slab entry is where the slab cut starts, from 0 on, or past the limit on a miss', () => {
  const g = lcg(5)
  let hits = 0
  for (let i = 0; i < 400; i++) {
    const low = take(g, 3),
      high = low.map((x) => x + 0.1 + Math.abs(2 * g() - 1))
    const origin = take(g, 3).map((x) => 3 * x)
    // Aimed at a point of the box grown twice about its centre: about half the rays hit it.
    const aim = take(g, 3).map((x, k) => (low[k] + high[k]) / 2 + x * (high[k] - low[k]))
    const direction = sub(aim, origin).map((x) => (Math.abs(x) < 0.01 ? 0.5 : x))
    const limit = 4
    const span = Float64Array.from([0, limit])
    const inverse = run.rayInverseDirection(direction) as V
    const entry = run.rayBoxEntry(low, high, origin, inverse, limit) as number
    if (slabCut(span, low, 0, high, 0, origin, direction)) {
      near(entry, span[0], `entry ${i}`)
      hits++
    } else assert.ok(entry > limit, `miss ${i}`)
  }
  assert.ok(hits > 50 && hits < 350, `both outcomes met: ${hits}`)
  // A zero component is taken as +1e-20 (`DIVISOR_FLOOR`, its f32): finite, never an infinity.
  const floored = (run.rayInverseDirection([0, -0, 2]) as V).map(Math.fround)
  assert.deepEqual(floored, [Math.fround(1e20), Math.fround(1e20), 0.5])
})

test('the ray meets the triangle where the ray meets its plane inside its corners', () => {
  const g = lcg(9)
  let hits = 0
  for (let i = 0; i < 400; i++) {
    const [a, b, c] = [take(g, 3), take(g, 3), take(g, 3)]
    const origin = take(g, 3).map((x) => 2 * x),
      limit = 3
    // Aimed at the triangle's plane through weights in [-0.5, 1.5]: about half fall inside.
    const [u, v] = take(g, 2).map((x) => 0.5 + x)
    const aim = a.map((x, k) => x + u * (b[k] - x) + v * (c[k] - x))
    const direction = sub(aim, origin)
    const got = run.rayTriangleDistance(origin, direction, a, b, c, limit) as number
    // Independent: the plane's distance along the ray, then the point's side of each edge.
    const n = run.faceNormal(a, b, c) as V
    const t = dot(n, sub(a, origin)) / dot(n, direction)
    const p = origin.map((x, k) => x + t * direction[k])
    const sides = [
      [a, b],
      [b, c],
      [c, a],
    ].map(([u, w]) => dot(run.faceNormal(u, w, p) as V, n))
    const inside = sides.every((s) => s >= 0) || sides.every((s) => s <= 0)
    const want = inside && t > 1e-4 && t < limit ? t : limit
    // A ray grazing an edge may fall either side of it in rounding: those are left out.
    if (Math.min(...sides.map(Math.abs)) < 1e-9) continue
    near(got, want, `ray ${i}`)
    hits += Number(want < limit)
  }
  assert.ok(hits > 20, `hits met: ${hits}`)
})
