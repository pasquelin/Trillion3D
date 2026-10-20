// The ray declarations of the maths library (`packages/math/src/wgsl/geometry.ts`), their shipped
// text run in JavaScript against the processor's twin — the slab cut — and independent references:
// the ray against a box, a triangle and a segment.
import test from 'node:test'
import assert from 'node:assert/strict'
import { slabCut } from '../../../../math/src/geometry/slab.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { nearRelative } from '../../../../math/src/float/near.fixture.ts'
import { dotVector3 } from '../../../../math/src/vector/vector.ts'
import { subtract } from '../../../../math/src/vector/vectorTuple.ts'
import { run, take, type V } from './libraryGeometry.fixture.ts'

test('the slab entry is where the slab cut starts, from 0 on, or past the limit on a miss', () => {
  const g = lcgRandom(5)
  let hits = 0
  for (let i = 0; i < 400; i++) {
    const low = take(g, 3),
      high = low.map((x) => x + 0.1 + Math.abs(2 * g() - 1))
    const origin = take(g, 3).map((x) => 3 * x)
    // Aimed at a point of the box grown twice about its centre: about half the rays hit it.
    const aim = take(g, 3).map((x, k) => (low[k] + high[k]) / 2 + x * (high[k] - low[k]))
    const direction = subtract(aim, origin).map((x) => (Math.abs(x) < 0.01 ? 0.5 : x))
    const limit = 4
    const span = Float64Array.from([0, limit])
    const inverse = run.rayInverseDirection(direction) as V
    const entry = run.rayBoxEntry(low, high, origin, inverse, limit) as number
    if (slabCut(span, low, 0, high, 0, origin, direction)) {
      nearRelative(entry, span[0], `entry ${i}`)
      hits++
    } else assert.ok(entry > limit, `miss ${i}`)
  }
  assert.ok(hits > 50 && hits < 350, `both outcomes met: ${hits}`)
  // A zero component is taken as +1e-20 (`DIVISOR_FLOOR`, its f32): finite, never an infinity.
  const floored = (run.rayInverseDirection([0, -0, 2]) as V).map(Math.fround)
  assert.deepEqual(floored, [Math.fround(1e20), Math.fround(1e20), 0.5])
})

test('the ray meets the triangle where the ray meets its plane inside its corners', () => {
  const g = lcgRandom(9)
  let hits = 0
  for (let i = 0; i < 400; i++) {
    const [a, b, c] = [take(g, 3), take(g, 3), take(g, 3)]
    const origin = take(g, 3).map((x) => 2 * x),
      limit = 3
    // Aimed at the triangle's plane through weights in [-0.5, 1.5]: about half fall inside.
    const [u, v] = take(g, 2).map((x) => 0.5 + x)
    const aim = a.map((x, k) => x + u * (b[k] - x) + v * (c[k] - x))
    const direction = subtract(aim, origin)
    const got = run.rayTriangleDistance(origin, direction, a, b, c, limit) as number
    // Independent: the plane's distance along the ray, then the point's side of each edge.
    const n = run.faceNormal(a, b, c) as V
    const t = dotVector3(n, subtract(a, origin)) / dotVector3(n, direction)
    const p = origin.map((x, k) => x + t * direction[k])
    const sides = [
      [a, b],
      [b, c],
      [c, a],
    ].map(([u, w]) => dotVector3(run.faceNormal(u, w, p) as V, n))
    const inside = sides.every((s) => s >= 0) || sides.every((s) => s <= 0)
    const want = inside && t > 1e-4 && t < limit ? t : limit
    // A ray grazing an edge may fall either side of it in rounding: those are left out.
    if (Math.min(...sides.map(Math.abs)) < 1e-9) continue
    nearRelative(got, want, `ray ${i}`)
    hits += Number(want < limit)
  }
  assert.ok(hits > 20, `hits met: ${hits}`)
})

// A line has no area: the ray meets it where it passes within its reach. Against a dense walk of
// the segment, each point's nearest point on the ray: met exactly where the walk comes within
// reach, at the parameter of the nearest pass.
test('a ray meets a segment where it passes within reach, at its nearest pass', () => {
  const g = lcgRandom(19)
  let met = 0
  for (let i = 0; i < 300; i++) {
    const origin = take(g, 3).map((x) => x * 4),
      a = take(g, 3),
      b = take(g, 3),
      aim = take(g, 3).map((x, c) => (a[c] + b[c]) / 2 + x * 0.3),
      direction = subtract(aim, origin).map((x) => x * (0.5 + Math.abs(take(g, 1)[0]))),
      reach = 0.05 + Math.abs(take(g, 1)[0]) * 0.3
    const dd = dotVector3(direction, direction)
    let nearest = Infinity,
      at = 0
    for (let k = 0; k <= 4000; k++) {
      const p = a.map((x, c) => x + ((b[c] - x) * k) / 4000)
      const t = Math.max(0, dotVector3(direction, subtract(p, origin)) / dd)
      const gap = subtract(
        origin.map((x, c) => x + direction[c] * t),
        p,
      )
      const d = Math.sqrt(dotVector3(gap, gap))
      if (d < nearest) [nearest, at] = [d, t]
    }
    const t = run.raySegmentDistance(origin, direction, a, b, reach, 1e9) as number
    if (t < 1e9) {
      met++
      assert.ok(nearest <= reach + 1e-3, `ray ${i} met past its reach (${nearest} > ${reach})`)
      assert.ok(Math.abs(t - at) <= 1e-2 * Math.max(1, at), `ray ${i} at ${t}, nearest at ${at}`)
    } else assert.ok(nearest >= reach - 1e-3 || at <= 1e-4, `ray ${i} missed within reach`)
  }
  assert.ok(met > 50 && met < 290, `some rays meet their segment (${met})`)
  assert.equal(
    run.raySegmentDistance([0, 0, -5], [0, 0, 1], [1, 0, 0], [-1, 0, 0], 0.1, 3),
    3,
    'past the limit',
  )
  assert.equal(
    run.raySegmentDistance([0, 0, -5], [0, 0, 2], [1, 0, 0], [-1, 0, 0], 0.1, 9),
    2.5,
    'in the ray’s units',
  )
})
