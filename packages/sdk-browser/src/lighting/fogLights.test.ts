// The lights of the fog volume other than the sun (`fogScatterRun.fixture.ts`): a lamp by the inverse
// square of its distance, the sky by its radiance, a rectangle by half the length of its vector form
// factor. Split from `fogScatter.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../math/src/float/near.fixture.ts'
import { LIGHT_FLAG } from '../../../sdk-core/src/scene/light/contracts.ts'
import { cross, subtract, unit } from '../../../math/src/vector/vectorTuple.ts'
import { EYE, phase, pointOf, type V3 } from './fogVolumeRun.fixture.ts'
import { CELL, EXTINCTION, G, SUN, scatter, type Light } from './fogScatterRun.fixture.ts'
import { IRRADIANCE_TERMS } from '../../../sdk-core/src/scene/core/irradianceTerms.ts'

test('a lamp scatters its colour over the squared distance, a cell’s size added to it; the sky its radiance', () => {
  const lamp: Light = {
    positionRange: [1, 4, -6, 40],
    colorIntensity: [1, 1, 1, 50],
    directionCone: [0, 0, 0, -2],
    params: [0, -1, 1, -2],
    shape: [0, 0, 0, 0],
    capsule: [0, 0, 0, 0],
  }
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
  const lamp: Light = {
    positionRange: [...centre, 40],
    colorIntensity: [1, 1, 1, 50],
    directionCone: [0, 0, 0, -2],
    params: [0, -1, 1, -2],
    shape: [0, 0, 0, 0],
    capsule: [0, 0, 0, 0],
  }
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
  const [p0, p1] = [subtract(offset, half), offset.map((v, i) => v + half[i])]
  const [r0, r1] = [Math.hypot(...p0), Math.hypot(...p1)]
  const c = p0.reduce((s, v, i) => s + v * p1[i], 0) / (r0 * r1)
  const falloff = 1 / (((1 + c) / 2) * r0 * r1 + 1e-4)
  const tube = 50 * window(Math.sqrt(d2)) * falloff
  // The phase function reads the direction to the lamp's centre, as the lamp's own light does.
  const want = tube * phase(G, unit(subtract(centre, P)), toEye)
  const got = lit({ ...lamp, capsule: [...half, 0] })
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
      params: [3, -1, 1, -2],
      shape: [...U, 0.5],
      capsule: [0, 0, 0, 0],
    }
    // The corners relative to the point; every edge's term the angle between its two corners times
    // the unit normal of their plane, the angle by the exact `atan2` of the cross product and the dot.
    const o = subtract(centre, P)
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

/** A lamp five metres off the cell's point, whole in its range: lit by its inverse square. */
const lampAt = (P: V3): Light => ({
  positionRange: [P[0] + 3, P[1] + 4, P[2], 40],
  colorIntensity: [1, 1, 1, 50],
  directionCone: [0, 0, 0, -2],
  params: [0, -1, 1, -2],
  shape: [0, 0, 0, 0],
  capsule: [0, 0, 0, 0],
})
const lit = (world: Parameters<typeof scatter>[1]) => scatter(CELL, world)![0]

test('a light’s share scales what the fog scatters of it and a share of none leaves it out; the sky has one', () => {
  const lamp = lampAt(pointOf(CELL))
  const full = lit({ lights: [lamp] })
  assert.ok(full > 0)
  near(
    [lit({ lights: [{ ...lamp, params: [0, -1, 0.25, -2] }] })],
    [full * 0.25],
    'a quarter',
    1e-6,
  )
  near([lit({ lights: [{ ...lamp, params: [0, -1, 0, -2] }] })], [0], 'none of it', 0)
  const sky = lit({ sky: [3, 3, 3] })
  near([lit({ sky: [3, 3, 3], skyShare: 0.5 })], [sky * 0.5], 'half the sky', 1e-6)
  near([lit({ sky: [3, 3, 3], skyShare: 0 })], [0], 'no sky light, no sky', 0)
})

test('the sun and a local light shadow the fog only where their flag says so, by their shadow slot’s read', () => {
  const lamp = lampAt(pointOf(CELL))
  const whole = lit({ lights: [lamp] })
  const sun = lit({ lights: [SUN], sunRank: 0 })
  assert.ok(whole > 0 && sun > 0)
  const reads: number[] = []
  near(
    [lit({ lights: [SUN], sunRank: 0, shade: 0.25, shadowReads: reads })],
    [sun / 4],
    'sun shade',
    1e-6,
  )
  assert.deepEqual(reads, [SUN.params[0]], 'asked once, of the sun')
  // A lamp that does not shadow the fog is lit whole, whatever its shadow reads.
  reads.length = 0
  near([lit({ lights: [lamp], shade: 0.5, shadowReads: reads })], [whole], 'not flagged', 1e-6)
  assert.deepEqual(reads, [], 'an unflagged lamp reads no shadow')
  // Flagged, it takes the share its shadow lets through.
  const flagged = { ...lamp, params: [LIGHT_FLAG.shadowsFog, 3, 1, -2] }
  near([lit({ lights: [flagged], shade: 0.25 })], [whole * 0.25], 'flagged', 1e-6)
  near([lit({ lights: [flagged], shade: 0 })], [0], 'in shadow', 0)
})

test('a spot’s cone and a rectangle’s plane fade over a number of cells, so that they flicker less', () => {
  const P = pointOf(CELL)
  // The flat cell: its point to the far corner of the cell on its slice, what a cell of fade is.
  const cell = Math.hypot(...subtract(P, pointOf([4, 5, 2])))
  const fade = 1 // cells
  const settings = { volumetricFogEdgeFade: fade }
  const share = (light: Light) => lit({ lights: [light], settings }) / lit({ lights: [light] })
  // A spot looking straight down from 3 m above the point, a 60° cone: its aperture at the point's
  // depth is 3 · tan 60°, and the point lies 0.3 fade inside it.
  const aperture = 3 * Math.tan(Math.PI / 3)
  const spot: Light = {
    positionRange: [P[0] + aperture - 0.3 * cell, P[1] + 3, P[2], 40],
    colorIntensity: [1, 1, 1, 50],
    directionCone: [0, -1, 0, 0.5],
    params: [1, -1, 1, -2],
    shape: [0, 0, 0, 0],
    capsule: [0, 0, 0, 0],
  }
  near([share(spot)], [0.3], 'spot', 2e-3)
  // Well inside, no fade; and a point lamp has none, whatever the number.
  assert.equal(share({ ...spot, positionRange: [P[0] + 0.1, P[1] + 3, P[2], 40] }), 1)
  assert.equal(share(lampAt(P)), 1)
  // A rectangle facing up, the point 0.4 fade in front of its plane.
  const rect: Light = {
    positionRange: [P[0], P[1] - 0.4 * cell, P[2], 40],
    colorIntensity: [1, 1, 1, 50],
    directionCone: [0, 1, 0, -2],
    params: [3, -1, 1, -2],
    shape: [1, 0, 0, 0.5],
    capsule: [0, 0, 0, 0],
  }
  near([share(rect)], [0.4], 'rect', 2e-3)
  assert.equal(share({ ...rect, positionRange: [P[0], P[1] - 5 * cell, P[2], 40] }), 1)
})

test('the sky light scatters only where the scene has one, with the fog’s colours too', () => {
  const sky = [3, 3, 3]
  const whole = lit({ sky })
  assert.ok(whole > 0)
  // The fog's own colour times the ambient harmonic, where the medium is lit by the fog's colours.
  const colours = { sky: [0, 0, 0], fogColor: [0.2, 0.4, 0.6], volumetric: { useFogColors: true } }
  const ambient = IRRADIANCE_TERMS[0].basis
  near(
    scatter(CELL, colours)!.slice(0, 3),
    [0.2, 0.4, 0.6].map((c) => c * ambient * EXTINCTION),
    'colours',
    1e-6,
  )
  assert.equal(lit({ ...colours, skyLight: false }), 0, 'no sky light, no sky term')
  assert.equal(lit({ sky, skyLight: false }), 0)
})
