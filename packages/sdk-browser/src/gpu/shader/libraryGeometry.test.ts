// The triangle and plane declarations of the maths library (`packages/math/src/wgsl/geometry.ts`),
// their shipped text run in JavaScript against the processor's twin — the frustum's box test — and
// independent references.
import test from 'node:test'
import assert from 'node:assert/strict'
import { frustumExcludesBox } from '../../../../math/src/geometry/frustum/box.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { nearRelative } from '../../../../math/src/float/near.fixture.ts'
import { dotVector3 } from '../../../../math/src/vector/vector.ts'
import { subtract } from '../../../../math/src/vector/vectorTuple.ts'
import { run, take, type V } from './libraryGeometry.fixture.ts'

test('the face normal is across both edges, twice the area long', () => {
  const g = lcgRandom(7)
  for (let i = 0; i < 50; i++) {
    const [p0, p1, p2] = [take(g, 3), take(g, 3), take(g, 3)]
    const n = run.faceNormal(p0, p1, p2) as V
    nearRelative(dotVector3(n, subtract(p1, p0)), 0, 'edge 1')
    nearRelative(dotVector3(n, subtract(p2, p0)), 0, 'edge 2')
    const [a, b] = [subtract(p1, p0), subtract(p2, p0)]
    nearRelative(
      dotVector3(n, n),
      dotVector3(a, a) * dotVector3(b, b) - dotVector3(a, b) ** 2,
      'length² = (2·area)²',
    )
  }
})

test('the rejection is across the normal and leaves v along it', () => {
  const g = lcgRandom(11)
  for (let i = 0; i < 50; i++) {
    const v = take(g, 3),
      raw = take(g, 3),
      N = raw.map((x) => x / Math.sqrt(dotVector3(raw, raw)))
    const t = run.vectorRejection(v, N) as V
    nearRelative(dotVector3(t, N), 0, 'across')
    nearRelative(
      dotVector3(subtract(v, t), subtract(v, t)),
      dotVector3(v, N) ** 2,
      'what remains is along N',
    )
  }
})

test('the sine from the cosine is the sine of its angle, and none past ±1', () => {
  for (let a = 0; a <= Math.PI; a += Math.PI / 64)
    nearRelative(run.sinFromCosUnclamped(Math.cos(a)) as number, Math.sin(a), `${a}`)
  assert.ok(Number.isNaN(run.sinFromCosUnclamped(1 + 2 ** -20)))
})

test('the fast arccosine is within 0.009 radian of the arccosine, exact at the ends and the middle, and turns at zero', () => {
  for (let x = -1; x <= 1; x += 1 / 64)
    assert.ok(
      Math.abs((run.fastAcos(x) as number) - Math.acos(x)) <= 0.0091,
      `${x}: ${run.fastAcos(x)} against ${Math.acos(x)}`,
    )
  assert.equal(run.fastAcos(1), 0)
  assert.ok(Math.abs((run.fastAcos(0) as number) - Math.PI / 2) < 1e-6)
  assert.ok(Math.abs((run.fastAcos(-1) as number) - Math.PI) < 1e-6)
  // A cosine rounded a hair past one either way is read as one: a right number, never the root of a negative one. The value
  // is the f32 dot of the unit vector of (1.6771588, −1.4836919, −0.2127332) with itself, normalised in f32.
  assert.equal(run.fastAcos(1.0000003576278687), 0)
  assert.ok(Math.abs((run.fastAcos(-1.0000003576278687) as number) - Math.PI) < 1e-6)
})

test('the fast arctangent follows the arctangent of a tangent from zero up, either side of one', () => {
  for (const x of [0, 0.05, 0.25, 0.5, 0.9, 1, 1.1, 2, 4, 10, 100, 1e6])
    assert.ok(
      Math.abs((run.fastAtan(x) as number) - Math.atan(x)) <= 0.005,
      `${x}: ${run.fastAtan(x)} against ${Math.atan(x)}`,
    )
})

/** The arithmetic of the reference's `atan2Fast` in single precision, step for step, with no guard at the origin. */
function referenceAtan2Fast(y: number, x: number) {
  const f = Math.fround
  const t0 = f(Math.max(Math.abs(x), Math.abs(y)))
  const t1 = f(Math.min(Math.abs(x), Math.abs(y)))
  let t3 = f(t1 / t0)
  const t4 = f(t3 * t3)
  let poly = f(0.0872929)
  poly = f(f(poly * t4) - f(0.301895))
  poly = f(f(poly * t4) + 1)
  t3 = f(poly * t3)
  t3 = Math.abs(y) > Math.abs(x) ? f(f(0.5 * Math.PI) - t3) : t3
  t3 = x < 0 ? f(f(Math.PI) - t3) : t3
  return y < 0 ? -t3 : t3
}

test('the fast two-argument arctangent follows the angle of the vector in every quadrant, within 0.0014 radian of the arctangent and a millionth of the reference arithmetic', () => {
  const g = lcgRandom(5)
  for (let i = 0; i < 400; i++) {
    const [x, y] = take(g, 2)
    const fast = run.fastAtan2(y, x) as number
    assert.ok(Math.abs(fast - Math.atan2(y, x)) <= 0.0014, `${y}, ${x}: ${fast}`)
    assert.ok(Math.abs(fast - referenceAtan2Fast(y, x)) <= 1e-6, `${y}, ${x}: ${fast}`)
  }
  // The four axes, where the ratio is 0 or 1 over a larger: exact, the cut at x < 0 taking π and y < 0 the sign.
  assert.equal(run.fastAtan2(0, 1), 0)
  assert.ok(Math.abs((run.fastAtan2(1, 0) as number) - Math.PI / 2) < 1e-6)
  assert.ok(Math.abs((run.fastAtan2(0, -1) as number) - Math.PI) < 1e-6)
  assert.ok(Math.abs((run.fastAtan2(-1, 0) as number) + Math.PI / 2) < 1e-6)
})

test('the reference’s two-argument arctangent is not a number at the origin, where ours is 0, the angle of two zeros by convention', () => {
  // 0 / 0 is NaN in IEEE single precision, for a zero of either sign, and the NaN runs through every step after it.
  for (const [y, x] of [
    [0, 0],
    [-0, -0],
    [0, -0],
    [-0, 0],
  ]) {
    assert.ok(Number.isNaN(referenceAtan2Fast(y, x)), `${y}, ${x}: the reference`)
    const fast = run.fastAtan2(y, x) as number
    assert.ok(Number.isFinite(fast), `${y}, ${x}: ours`)
    assert.equal(fast, 0)
  }
  // A single zero is a right ratio, 0 or 1 over the other, for both: the reference is defined there and ours is its value.
  for (const [y, x] of [
    [0, -2],
    [-0, 3],
    [4, 0],
    [-5, -0],
  ])
    assert.ok(
      Math.abs((run.fastAtan2(y, x) as number) - referenceAtan2Fast(y, x)) <= 1e-6,
      `${y}, ${x}`,
    )
})

test('a box behind a plane is what the frustum test culls; a sphere, by its centre and radius', () => {
  const g = lcgRandom(3)
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
    const length = Math.sqrt(dotVector3(plane, plane))
    const unit = plane.map((x) => x / length)
    const centre = take(g, 3),
      radius = Math.abs(2 * g() - 1)
    assert.equal(
      run.sphereBehindPlane(unit, centre, radius),
      dotVector3(unit, centre) + unit[3] < -radius,
    )
  }
  assert.ok(culled > 50 && culled < 350, `both verdicts met: ${culled}`)
})
