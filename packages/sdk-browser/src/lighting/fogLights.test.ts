// The lights of the fog volume other than the sun (`fogScatterRun.fixture.ts`): a lamp by the inverse
// square of its distance, the sky by its radiance, a rectangle by half the length of its vector form
// factor. Split from `fogScatter.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../math/src/float/near.fixture.ts'
import { IRRADIANCE_BAND } from '../../../sdk-core/src/scene/core/environment.ts'
import { EYE, norm, phase, pointOf, sub, type V3 } from './fogVolumeRun.fixture.ts'
import { CELL, EXTINCTION, G, scatter, type Light } from './fogScatterRun.fixture.ts'

test('a lamp scatters its colour over the squared distance, a cell’s size added to it; the sky its radiance', () => {
  const lamp: Light = {
    positionRange: [1, 4, -6, 40],
    colorIntensity: [1, 1, 1, 50],
    directionCone: [0, 0, 0, -2],
    params: [0, -1, 0, -2],
    shape: [0, 0, 0, 0],
    capsule: [0, 0, 0, 0],
  }
  const P = pointOf(CELL)
  const toLamp = sub([1, 4, -6], P)
  const d = Math.hypot(...toLamp)
  const bias = Math.max(Math.hypot(...sub(P, pointOf([4, 5, 3]))), 0.01)
  const window = Math.max(1 - (d / 40) ** 4, 0) ** 2
  const got = scatter(CELL, { lights: [lamp] })!
  const want = (50 * window * phase(G, norm(toLamp), norm(sub(EYE, P)))) / (d * d + bias * bias)
  near(got, [want * EXTINCTION, want * EXTINCTION, want * EXTINCTION, EXTINCTION], 'lamp', 1e-6)
  // Out of its range it lights nothing.
  near(
    scatter(CELL, { lights: [{ ...lamp, positionRange: [1, 4, -6, 3] }] })!.slice(0, 3),
    [0, 0, 0],
    'range',
    0,
  )
  // The sky: its first coefficient's radiance, the irradiance over π.
  const sky = scatter(CELL, { sky: [3, 3, 3] })!
  const radiance = (3 * IRRADIANCE_BAND.constant) / Math.PI
  near(
    sky,
    [radiance * EXTINCTION, radiance * EXTINCTION, radiance * EXTINCTION, EXTINCTION],
    'sky',
    1e-6,
  )
})

test('a lamp’s bias is a cell’s radius, a square centimetre at least; a lamp with a tube is lit along it', () => {
  const P = pointOf(CELL)
  // A lamp five centimetres from the point, where a square centimetre is a visible share of the
  // squared distance (4 %).
  const centre = [P[0] + 0.03, P[1] + 0.04, P[2]]
  const lamp: Light = {
    positionRange: [...centre, 40],
    colorIntensity: [1, 1, 1, 50],
    directionCone: [0, 0, 0, -2],
    params: [0, -1, 0, -2],
    shape: [0, 0, 0, 0],
    capsule: [0, 0, 0, 0],
  }
  const offset = sub(centre, P)
  const toEye = norm(sub(EYE, P))
  const window = (distance: number) => Math.max(1 - (distance / 40) ** 4, 0) ** 2
  const lit = (light: Light) =>
    scatter(CELL, { lights: [light], settings: { volumetricFogLampSoftening: 0 } })![0] / EXTINCTION
  // No cell radius to add: the squared distance is a square centimetre longer, not the real one alone.
  const d2 = offset.reduce((s, v) => s + v * v, 0)
  const point = (50 * window(Math.sqrt(d2)) * phase(G, norm(offset), toEye)) / (d2 + 1e-4)
  // (The cell's point is a 32-bit float: five centimetres of it carry a few parts in 10⁴.)
  assert.ok(Math.abs(lit(lamp) / point - 1) < 1e-3, `${lit(lamp)} against ${point}`)
  // A tube: the half axis times its length, the falloff the integral of the inverse square along it,
  // `1 / ((1 + c) / 2 · |p₀||p₁| + bias)` for the cosine `c` between the directions to its two ends.
  const half = [0.5, 0, 1.5]
  const [p0, p1] = [sub(offset, half), offset.map((v, i) => v + half[i])]
  const [r0, r1] = [Math.hypot(...p0), Math.hypot(...p1)]
  const c = p0.reduce((s, v, i) => s + v * p1[i], 0) / (r0 * r1)
  const falloff = 1 / (((1 + c) / 2) * r0 * r1 + 1e-4)
  const tube = 50 * window(Math.sqrt(d2)) * falloff
  // The phase function reads the direction to the lamp's centre, as the lamp's own light does.
  const want = tube * phase(G, norm(offset), toEye)
  const got = lit({ ...lamp, capsule: [...half, 0] })
  assert.ok(Math.abs(got / want - 1) < 1e-3, `${got} against ${want}`)
  assert.ok(Math.abs(got / point - 1) > 1e-3, 'not the point lamp’s')
})

const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

test('a rectangle scatters half the length of its vector form factor, each edge by the exact angle it subtends', () => {
  const P = pointOf(CELL)
  const toEye = norm(sub(EYE, P))
  // A rectangle at `away` from the point, facing it, 2 m by 1 m, 50 lumens of whatever the unit is.
  const rect = (away: V3, range: number) => {
    const centre = P.map((c, i) => c + away[i])
    const n = norm(sub(P, centre))
    const U = norm(cross(n, [0, 1, 0]))
    const W = norm(cross(U, n)).map((c) => c * 0.5)
    const light: Light = {
      positionRange: [...centre, range],
      colorIntensity: [1, 1, 1, 50],
      directionCone: [...n, -2],
      params: [3, -1, 0, -2],
      shape: [...U, 0.5],
      capsule: [0, 0, 0, 0],
    }
    // The corners relative to the point; every edge's term the angle between its two corners times
    // the unit normal of their plane, the angle by the exact `atan2` of the cross product and the dot.
    const o = sub(centre, P)
    const corner = (u: number, w: number) => o.map((c, i) => c + u * U[i] + w * W[i])
    const ring = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]
    const form = ring.reduce(
      (sum, p, k) => {
        const q = ring[(k + 1) % 4]
        const c = cross(p, q)
        const length = Math.hypot(...c)
        const angle = Math.atan2(
          length,
          p.reduce((s, v, i) => s + v * q[i], 0),
        )
        return sum.map((v, i) => v + (c[i] / length) * angle)
      },
      [0, 0, 0],
    )
    const distance = Math.hypot(...o)
    const window = Math.max(1 - (distance / range) ** 4, 0) ** 2
    const want = 50 * 0.5 * Math.hypot(...form) * window * phase(G, norm(o), toEye) * EXTINCTION
    return { light, want }
  }
  // Near, where a polynomial in place of the angle would show, and a thousand metres away, where the
  // angles are tiny and the cross products tinier.
  for (const [away, range, tolerance] of [
    [[1, 3, 0.5], 40, 1e-5],
    [[300, 800, 500], 4000, 2e-3],
  ] as [V3, number, number][]) {
    const { light, want } = rect(away, range)
    const got = scatter(CELL, { lights: [light] })![0]
    assert.ok(want > 0 && Math.abs(got / want - 1) < tolerance, `${away}: ${got} against ${want}`)
  }
})
