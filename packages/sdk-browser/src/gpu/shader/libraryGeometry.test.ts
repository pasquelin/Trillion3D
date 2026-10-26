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
