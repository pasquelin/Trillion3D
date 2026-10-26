// The local fog volumes (`./fog/localWgsl.ts`, `./fogCompose.ts`), the shipped shader text run as shipped
// (`shaderRun`) on the block the plan writes (`./fog/localPlan.ts`) against the same law integrated step by
// step (`fogLocalRun.fixture.ts`): the coverage of a volume along a ray, the light it scatters, the cuts
// the start distances and the fog's volume make, the volumes laid one over another, what they add to
// the fog's volume, and how the fog is laid over a point with them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../math/src/float/near.fixture.ts'
import {
  EYE,
  coverageOracle,
  localSlots,
  mediumOf,
  overOf,
  placed,
  planSettings,
} from './fogLocalRun.fixture.ts'
import type { Vec3 as V3 } from '../../../math/src/vector/vectorTuple.ts'

/** The ray from the eye to the point `to`. */
const toward = (to: V3): V3 => [to[0] - EYE[0], to[1] - EYE[1], to[2] - EYE[2]]

test('the coverage of a volume along a ray: its radial and its height integrals, combined, over the stretch the sphere leaves', () => {
  const at: V3 = [0, 2, -10]
  const cases: [string, Parameters<typeof placed>[2], V3][] = [
    ['through the centre, a little up', {}, [0, 2.5, -30]],
    ['off the centre', { radialDensity: 2, heightDensity: 0.5 }, [1.5, 3, -30]],
    [
      'a thin sphere over a steep height law',
      { radialDensity: 0.05, heightDensity: 2, heightFalloff: 300, heightOffset: 0.2 },
      [3, 9, -30],
    ],
    ['falling', { radialDensity: 0.7, heightDensity: 1.3, heightFalloff: 60 }, [-2, -3, -25]],
    ['the point inside the sphere', { radialDensity: 1.4 }, [0.5, 2.5, -9]],
    ['scaled by two', { scale: 2, radialDensity: 0.3, heightDensity: 0.1 }, [2, 5, -40]],
  ]
  for (const [name, more, to] of cases) {
    const volume = placed('v', at, more)
    const over = overOf(localSlots([volume]).slots)(toward(to))
    const want = coverageOracle(volume, toward(to))
    assert.ok(want > 0.001, `${name}: a ray that crosses`)
    near([1 - over[3]], [want], name, 2e-5)
  }
  // A level ray divides the height law by the rise of 1e-4 the engines that fixed it hold a rise to: its
  // coverage differs from the integral's by a few parts in a hundred thousand.
  const level = placed('v', at)
  near(
    [1 - overOf(localSlots([level]).slots)(toward([0, 2, -30]))[3]],
    [coverageOracle(level, toward([0, 2, -30]))],
    'level',
    1e-4,
  )
  // The coverages of the two laws multiply: a volume with no radial extinction, or none with height, shows
  // nothing at all — a thin one shows by the product of two thin coverages.
  for (const none of [{ radialDensity: 0 }, { heightDensity: 0 }])
    near(
      overOf(localSlots([placed('v', at, none)]).slots)(toward([0, 2, -30])),
      [0, 0, 0, 1],
      'one law alone',
      1e-12,
    )
  // A ray that misses the sphere, one that goes the other way and one that stops before it cover nothing.
  const sphere = placed('v', at)
  for (const to of [
    [20, 2, -10],
    [0, 2, 30],
    [0, 2, -3],
  ] as V3[])
    near(overOf(localSlots([sphere]).slots)(toward(to)), [0, 0, 0, 1], `${to}`, 1e-9)
  // The eye inside the sphere: the ray starts at it.
  const around = placed('v', [0, 2, -1])
  near(
    [1 - overOf(localSlots([around]).slots)(toward([0, 2.5, -20]))[3]],
    [coverageOracle(around, toward([0, 2.5, -20]))],
    'the eye inside',
    2e-5,
  )
})

test('what a volume scatters of the coverage: the sun by its phase function, the sky light along the ray reversed, its albedo, its emissive light', () => {
  const sun = { light: [4, 3, 2], toward: [0.6, 0.8, 0] }
  // The sky light's rows: its light along `n` is `max(0, a · n + b)` for each channel.
  const sky = [
    [0.1, 0, 0, 0.5],
    [0, 0.2, 0, 0.25],
    [0, 0, 0.3, -0.5],
  ]
  const volume = placed('v', [0, 2, -10], {
    albedo: [1, 0.5, 0.25],
    emissive: [0.2, 0, 0.1],
    scatteringDistribution: 0.4,
  })
  const to: V3 = [2, 4, -30]
  const ray = toward(to)
  const dir = ray.map((c) => c / Math.hypot(...ray))
  const over = overOf(localSlots([volume], { sun, sky }).slots)(ray)
  const g = 0.4
  const cosine = dir.reduce((s, c, i) => s + c * sun.toward[i], 0)
  // The phase function of the distribution reversed, of the cosine to the light.
  const phase = (1 - g * g) / (4 * Math.PI * (1 + g * g - 2 * g * cosine) ** 1.5)
  const around = dir.map((c) => -g * c)
  const skyLight = sky.map((r) =>
    Math.max(0, r[0] * around[0] + r[1] * around[1] + r[2] * around[2] + r[3]),
  )
  const coverage = coverageOracle(volume, ray)
  const want = [1, 0.5, 0.25].map(
    (a, c) => ((sun.light[c] * phase + skyLight[c]) * a + [0.2, 0, 0.1][c]) * coverage,
  )
  near(over.slice(0, 3), want, 'light', 5e-5)
  // No sun, no sky light, no emissive light: nothing scattered, the transmittance the same.
  const dark = overOf(localSlots([placed('v', [0, 2, -10])], { sun: null }).slots)(ray)
  near(dark.slice(0, 3), [0, 0, 0], 'dark', 1e-12)
  near([dark[3]], [1 - coverageOracle(placed('v', [0, 2, -10]), ray)], 'kept', 2e-5)
})

test('the start distances cut a volume: its own and the view’s, the larger; the fog’s volume, where it covers the near air, takes its share', () => {
  const at: V3 = [0, 2, -10]
  const to: V3 = [0, 2.3, -30]
  const coverage = (volume: ReturnType<typeof placed>, more = {}, excluded = 0) =>
    1 - overOf(localSlots([volume], more).slots, excluded)(toward(to))[3]
  // The sphere spans 5 to 15 metres along the ray.
  const whole = placed('v', at)
  near([coverage(whole)], [coverageOracle(whole, toward(to))], 'whole', 2e-5)
  // Its own start distance of 8: the stretch from 8 to 15; a start of 20 shows none.
  const own = placed('v', at, { startDistance: 8 })
  near([coverage(own)], [coverageOracle(own, toward(to), { start: 8 })], 'own', 2e-5)
  assert.equal(coverage(placed('v', at, { startDistance: 20 })), 0)
  // The view's start distance, the run's, holds the volume's own up: the larger of the two.
  const view = planSettings({ startDistance: 11 })
  near(
    [coverage(own, { settings: view })],
    [coverageOracle(whole, toward(to), { start: 11 })],
    'the view’s',
    2e-5,
  )
  // The fog's volume covers 12 metres of the near air along the ray: the rest is the volume's own.
  near(
    [coverage(whole, {}, 12)],
    [coverageOracle(whole, toward(to), { excluded: 12 })],
    'excluded',
    2e-5,
  )
  // Where the run keeps the volumes out of the fog's volume, the analytic law draws them whole.
  const outside = localSlots([whole], { settings: planSettings({ inVolume: false }) }).slots
  near(
    [1 - overOf(outside, 12)(toward(to))[3]],
    [coverageOracle(whole, toward(to))],
    'not in the volume',
    2e-5,
  )
})

test('the volumes are laid in the order of their priority, then their distance, the farther first, each over those before it', () => {
  const sun = { light: [1, 1, 1], toward: [0, 1, 0] }
  const far = placed('far', [0, 2, -16], { albedo: [1, 0, 0], radialDensity: 0.8 })
  const mid = placed('mid', [0, 2, -9], { albedo: [0, 1, 0], radialDensity: 0.6 })
  const close = placed('close', [0, 2, -4], { albedo: [0, 0, 1], radialDensity: 0.4 })
  const ray = toward([0, 2, -40])
  const single = (v: ReturnType<typeof placed>) => overOf(localSlots([v], { sun }).slots)(ray)
  const stack = (list: ReturnType<typeof placed>[]) =>
    list.reduce(
      (below, v) => {
        const s = single(v)
        return [
          below[0] * s[3] + s[0],
          below[1] * s[3] + s[1],
          below[2] * s[3] + s[2],
          below[3] * s[3],
        ]
      },
      [0, 0, 0, 1],
    )
  // Declared in any order, they are drawn far to near.
  for (const declared of [
    [far, mid, close],
    [close, far, mid],
    [mid, close, far],
  ])
    near(
      overOf(localSlots(declared, { sun }).slots)(ray),
      stack([far, mid, close]),
      'by distance',
      1e-9,
    )
  // A priority puts a volume over the others whatever its distance: the farthest of the three, drawn last.
  const first = { ...far, sortPriority: 5 }
  near(
    overOf(localSlots([close, first, mid], { sun }).slots)(ray),
    stack([mid, close, first]),
    'priority',
    1e-9,
  )
  // A volume with no extinction at all is never drawn.
  const none = placed('none', [0, 2, -8], {
    radialDensity: 0,
    heightDensity: 0,
    emissive: [9, 9, 9],
  })
  near(
    overOf(localSlots([close, none, far, mid], { sun }).slots)(ray),
    stack([far, mid, close]),
    'none',
    1e-9,
  )
})

test('what the volumes add to a cell of the fog’s volume: extinction by the radial fade and the height law, combined, capped, cut by the start distance', () => {
  const volume = placed('v', [0, 2, -10], {
    radialDensity: 0.5,
    heightDensity: 0.8,
    heightFalloff: 200,
    heightOffset: -0.1,
    albedo: [1, 0.5, 0.25],
    emissive: [2, 1, 0],
  })
  const medium = mediumOf(localSlots([volume]).slots)
  const radius = 5
  const cell = (d: V3) => d // relative to the eye
  const at: V3 = cell([1, 2, -12])
  // The unit space: the centre at (0, 0, −10) + eye (0, 2, 0): the cell lies (1, 2, −12) − (0, 0, −10)… from the eye.
  const unit = [(at[0] - 0) / radius, (at[1] - 0) / radius, (at[2] + 10) / radius]
  const fade = 1 - Math.hypot(...unit)
  const height = 0.8 * Math.exp(-2 * (unit[1] + 0.1))
  const radial = 0.5 * fade ** 0.82
  const a = Math.exp(-height),
    b = Math.exp(-radial)
  const extinction = -Math.log(a - a * b + b)
  assert.ok(extinction > 0.05 && extinction < 1)
  const got = medium(at, 20, 19)
  near([got.extinction], [extinction], 'extinction', 1e-6)
  near(got.scattering, [extinction, extinction * 0.5, extinction * 0.25], 'scattering', 1e-6)
  near(got.emissive, [2 * extinction, extinction, 0], 'emissive', 1e-6)
  // Outside the sphere: nothing. The most a cell takes, per metre, caps it.
  assert.equal(medium([9, 2, -12], 20, 19).extinction, 0)
  const dense = placed('v', [0, 2, -10], { radialDensity: 50, heightDensity: 50 })
  const low: V3 = [0.5, -2, -11]
  assert.equal(mediumOf(localSlots([dense]).slots)(low, 20, 19).extinction, 1)
  assert.equal(
    mediumOf(localSlots([dense], { settings: planSettings({ maxVolumeDensity: 0.25 }) }).slots)(
      low,
      20,
      19,
    ).extinction,
    0.25,
  )
  // The distances before the view's start of 10 metres are none; the volume's own start cuts a cell that
  // straddles it by the share of its depth past it, and a cell wholly before it is none.
  const view = planSettings({ startDistance: 10 })
  assert.equal(mediumOf(localSlots([volume], { settings: view }).slots)(at, 9, 8).extinction, 0)
  const late = mediumOf(localSlots([{ ...volume, startDistance: 14 }], { settings: view }).slots)
  near([late(at, 16, 12).extinction], [extinction * 0.5], 'straddled', 1e-6)
  assert.equal(late(at, 13, 12).extinction, 0)
})
