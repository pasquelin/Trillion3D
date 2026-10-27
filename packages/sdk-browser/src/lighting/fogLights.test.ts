// The lights of the fog volume other than the sun (`fogScatterRun.fixture.ts`): a lamp by the inverse
// square of its distance, the sky by its radiance, a rectangle by half the length of its vector form
// factor. Split from `fogScatter.test.ts`.
import { kindLane } from '../../../sdk-core/src/scene/light/lanes.fixture.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../math/src/float/near.fixture.ts'
import { cross, subtract, unit, type Vec3 } from '../../../math/src/vector/vectorTuple.ts'
import { EYE, phase, pointOf, type V3 } from './fogVolumeRun.fixture.ts'
import { CELL, EXTINCTION, G, lampOf, scatter, type Light } from './fogScatterRun.fixture.ts'

test('a lamp scatters its colour over the squared distance, a cell’s size added to it; the sky its radiance', () => {
  const lamp = lampOf([1, 4, -6])
  const P = pointOf(CELL)
  const toLamp = subtract([1, 4, -6], P)
  const d = Math.hypot(...toLamp)
  const bias = Math.max(Math.hypot(...subtract(P, pointOf([4, 5, 3]))), 0.01)
  const window = Math.max(1 - (d / 40) ** 4, 0) ** 2
  const got = scatter(CELL, { lights: [lamp] })!
  const want =
    (50 * window * phase(G, unit(toLamp), unit(subtract(EYE, P)))) / (d * d + bias * bias)
  near(got, [want * EXTINCTION, want * EXTINCTION, want * EXTINCTION, EXTINCTION], 'lamp', 1e-6)
  // Out of its range it lights nothing.
  near(
    scatter(CELL, { lights: [{ ...lamp, positionRange: [1, 4, -6, 3] }] })!.slice(0, 3),
    [0, 0, 0],
    'range',
    0,
  )
  // The sky: the sky light's diffuse light along the way to the eye, times its scattering intensity.
  const sky = scatter(CELL, { sky: [3, 3, 3] })!
  const radiance = 3
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
  const lamp = lampOf(centre)
  const offset = subtract(centre, P)
  const toEye = unit(subtract(EYE, P))
  const window = (distance: number) => Math.max(1 - (distance / 40) ** 4, 0) ** 2
  const lit = (light: Light) =>
    scatter(CELL, { lights: [light], settings: { volumetricFogLampSoftening: 0 } })![0] / EXTINCTION
  // No cell radius to add: the squared distance is a square centimetre longer, not the real one alone.
  const d2 = offset.reduce((s, v) => s + v * v, 0)
  const point =
    (50 * window(Math.sqrt(d2)) * phase(G, unit(subtract(centre, P)), toEye)) / (d2 + 1e-4)
  // (The cell's point is a 32-bit float: five centimetres of it carry a few parts in 10⁴.)
  assert.ok(Math.abs(lit(lamp) / point - 1) < 1e-3, `${lit(lamp)} against ${point}`)
  // A negative scale is no scale: the radius is held to the centimetre before it is squared.
  const negative = scatter(CELL, {
    lights: [lamp],
    settings: { volumetricFogLampSoftening: -5 },
  })![0]
  assert.equal(negative / EXTINCTION, lit(lamp))
  // A tube: the half axis times its length, the falloff the integral of the inverse square along it,
  // `1 / ((1 + c) / 2 · |p₀||p₁| + bias)` for the cosine `c` between the directions to its two ends.
  const half = [0.5, 0, 1.5]
  // The record holds the tube as its unit axis (`capsule.xyz`) and its half length (`traits.y`).
  const halfLength = Math.hypot(...half)
  const axis = half.map((v) => v / halfLength)
  const [p0, p1] = [subtract(offset, half), offset.map((v, i) => v + half[i])]
  const [r0, r1] = [Math.hypot(...p0), Math.hypot(...p1)]
  const c = p0.reduce((s, v, i) => s + v * p1[i], 0) / (r0 * r1)
  const falloff = 1 / (((1 + c) / 2) * r0 * r1 + 1e-4)
  const tube = 50 * window(Math.sqrt(d2)) * falloff
  // The phase function reads the direction to the lamp's centre, as the lamp's own light does.
  const want = tube * phase(G, unit(subtract(centre, P)), toEye)
  const got = lit({ ...lamp, capsule: [...axis, 0], traits: [0, halfLength, 0, 0] })
  assert.ok(Math.abs(got / want - 1) < 1e-3, `${got} against ${want}`)
  assert.ok(Math.abs(got / point - 1) > 1e-3, 'not the point lamp’s')
})

test('a rectangle scatters half the length of its vector form factor, each edge by the exact angle it subtends', () => {
  const P = pointOf(CELL)
  const toEye = unit(subtract(EYE, P))
  // A rectangle at `away` from the point, facing it, 2 m by 1 m, 50 of whatever the unit is.
  const rect = (away: V3, range: number) => {
    const centre = P.map((c, i) => c + away[i])
    const n = unit(subtract(P, centre))
    const U = unit(cross(n, [0, 1, 0]))
    const W = unit(cross(U, n)).map((c) => c * 0.5)
    const light: Light = {
      positionRange: [...centre, range],
      colorIntensity: [1, 1, 1, 50],
      directionCone: [...n, -2],
      params: [kindLane(3), -1, 1, -2],
      shape: [...U, 0.5],
      capsule: [0, 0, 0, 0],
      traits: [0, 0, 0, 0],
    }
    // The corners relative to the point; every edge's term the angle between its two corners times
    // the unit normal of their plane, the angle by the exact `atan2` of the cross product and the dot.
    const o = subtract(centre, P)
    const corner = (u: number, w: number): Vec3 => [
      o[0] + u * U[0] + w * W[0],
      o[1] + u * U[1] + w * W[1],
      o[2] + u * U[2] + w * W[2],
    ]
    const ring = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]
    const form = ring.reduce<number[]>(
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
    const want =
      50 * 0.5 * Math.hypot(...form) * window * phase(G, unit([...o]), toEye) * EXTINCTION
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
