// A lamp of size's highlight (`lampLight`, `lampLobeWgsl.ts`) runs the same lobes: with a source too small to see
// it is the point's, a sphere widens it and keeps its energy, a tube lights from the nearest point of it.
import test from 'node:test'
import { kindLane } from '../../../../sdk-core/src/scene/light/lanes.fixture.ts'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { F32_SCOPE } from '../shaderRunF32.fixture.ts'
import { NO_SHADING_MODEL } from './shadingModelScope.fixture.ts'
import { STANDARD_LIGHTING_WGSL } from '../standardLighting.ts'
import { LOBES_LIGHTING_WGSL } from './lobesWgsl.ts'
import { DIRECT_LIGHT_WGSL } from './lightWgsl.ts'
import { wgslConstants } from '../../materials/texture/shaderRule.fixture.ts'
import { lerp } from '../../../../math/src/scalar/reals.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { unitF32 } from '../../../../math/src/vector/unitF32.fixture.ts'

// The scope of the runs: f32, no shading model set.
const SCOPE = { ...F32_SCOPE, ...NO_SHADING_MODEL }
const fdot = F32_SCOPE.dot as (a: number[], b: number[]) => number
const fcross = F32_SCOPE.cross as (a: number[], b: number[]) => number[]
const flength = F32_SCOPE.length as (v: number[]) => number
type Fn<R = number[]> = (...args: unknown[]) => R
const AREA = wgslModule(DIRECT_LIGHT_WGSL, STANDARD_LIGHTING_WGSL, LOBES_LIGHTING_WGSL)
const AREA_NAMES = [
  'lobeSurface',
  'lampLight',
  'capsuleLamp',
  'lampLobe',
  'lobeEnergy',
  'sphereHalfCosines',
  'lineClosest',
  'capsuleLook',
  'lampLook',
  'surfaceLight',
]
const areaRun = (lobes: object) =>
  shaderRun<Record<string, Fn>>(AREA, AREA_NAMES, {
    ...SCOPE,
    ...wgslConstants(AREA),
    directLights: { items: [] },
    lobes,
  })
const area = areaRun({ on: false, skewed: false, coat: 0 }) as unknown as Record<string, Fn<any>>
const Z = [0, 0, 1],
  VIEW = [-0.6, 0, 0.8],
  MIRROR = [0.6, 0, 0.8]
const metal = (rough: number) => area.lobeSurface([1, 1, 1], 1, rough, Z, VIEW)

test('a lamp too small to see lights as the point does: the same lobe, the skew and the clear coat included', () => {
  const r = lcgRandom(1584),
    u = (lo: number, hi: number) => Math.fround(lerp(lo, hi, r()))
  for (let round = 0; round < 200; round++) {
    const N = unitF32([u(-1, 1), u(-1, 1), u(0.2, 1)]),
      V = unitF32([u(-1, 1), u(-1, 1), u(0.3, 1)])
    const L = unitF32([u(-1, 1), u(-1, 1), u(0.1, 1)])
    const T = unitF32(fcross(N, [0, 1, 0])),
      alpha = u(0.2, 0.8)
    const skewed = round % 3 === 0,
      coat = round % 2 ? 0.7 : 0
    const base = [u(0, 1), u(0, 1), u(0, 1)],
      metal = u(0, 1),
      rough = u(0.3, 1)
    const lobes = {
      on: skewed || coat > 0,
      skewed,
      T,
      B: fcross(N, T),
      coat,
      coatRough: 0.4,
      coatN: N,
      coatNoV: Math.min(Math.max(fdot(N, V), 0), 1),
      coatAlpha: Math.fround(0.4 * 0.4),
      baseColour: base,
      extinction: base.map((c) => Math.fround(-Math.log(Math.max(c / Math.PI, 0.0001)) / 2)),
      metal,
      baseRough: rough,
      at: Math.fround(alpha * 1.5),
      ab: alpha,
      invAt: Math.fround(1 / (alpha * 1.5)),
      invAb: Math.fround(1 / alpha),
      dScale: Math.fround(1 / (Math.PI * alpha * alpha * 1.5)),
      viewLength: 1,
    }
    const run = areaRun(lobes)
    const surface = run.lobeSurface(base, metal, rough, N, V)
    lobes.viewLength = flength([
      Math.fround(lobes.at * fdot(T, V)),
      Math.fround(alpha * fdot(lobes.B, V)),
      Math.max(fdot(N, V), 1e-4),
    ])
    const light = {
      positionRange: L.map((x) => x * 3),
      params: [0, 0, 0, 0],
      shape: [1e-6, 0, 1, 1],
      capsule: [0, 0, 0, 0],
    }
    const lamp = run.capsuleLamp(light.positionRange, [0, 0, 0], 1e-6, N, 1, 1e-4, true)
    const energy = u(1, 10)
    const sized = run.lampLight(surface, N, V, light, [0, 0, 0], lamp, energy),
      point = run.surfaceLight(surface, N, V, [...L, energy])
    for (let c = 0; c < 3; c++)
      assert.ok(
        Math.abs(sized[c] - point[c]) <= 2e-3 * Math.max(point[c], 1e-3),
        `${round}: ${sized} against ${point}`,
      )
  }
})

test('a sphere widens the highlight and keeps its energy; the soft radius and a tube widen it too', () => {
  // Known answers of the widening: a² 0.04 at V·H 0.8 with a sphere of sine 0.2, a soft radius's
  // sine 0.1, a tube whose ends are 0.6 apart in cosine.
  const energy = (sine: number, soft: number, lineCos: number) =>
    area.lobeEnergy(0.04, 0.8, sine, soft, lineCos)
  assert.deepEqual(energy(0, 0, 1), [0.04, 1])
  near(energy(0.2, 0, 1), [0.04, 0.444753], 1e-5)
  near(energy(0, 0.1, 1), [0.043049, 1], 1e-5)
  near(energy(0, 0, 0.6), [0.04, 0.434688], 1e-5)
  near(energy(0.2, 0.1, 0.6), [0.043049, 0.249152], 1e-5)
  assert.equal(energy(0, 0, -1)[1], 0, 'ends seen opposite: a half turn, no energy, not a floor')
  // In the mirror direction the half vector is the normal's, `V·H` the view's cosine; a little off
  // it the sphere moves the half vector toward the normal, never away.
  near(area.sphereHalfCosines(0.8, 0.8, 0.28, 0.2), [1, 0.8], 1e-6)
  const off = [Math.sin(0.4), 0, Math.cos(0.4)]
  const plainH = fdot(Z, unitF32(off.map((x, k) => x + VIEW[k])))
  const moved = area.sphereHalfCosines(off[2], 0.8, fdot(off, VIEW), 0.2)
  assert.ok(moved[0] >= plainH && moved[0] <= 1, `${moved} against ${plainH}`)
  // The highlight: a sphere of 0.2 at 1 m lowers the mirror's peak and raises the lobe's flank.
  const lobe = (toward: number[], reach: number, soft = 0) =>
    area.lampLobe(metal(0.3), Z, VIEW, { toward, reach, soft }, toward[2], 1, 1)[0]
  const tilted = [Math.sin(1.1), 0, Math.cos(1.1)]
  assert.ok(lobe(MIRROR, 0.2) < lobe(MIRROR, 0), 'a lower peak')
  assert.ok(lobe(tilted, 0.2) > lobe(tilted, 0), 'a higher flank')
  assert.ok(lobe(MIRROR, 0, 0.1) < lobe(MIRROR, 0), 'the soft radius lowers the peak too')
})

test('a tube lights from the nearest point of it to the reflection', () => {
  const look = (halfX: number, view: number[]) =>
    area.capsuleLook([0, 0, 2], [halfX, 0, 0], 0, 0, Z, view)
  // The reflection of the view meets the tube: the highlight comes from that point, along the ray.
  const view = unitF32([-0.25, 0, 0.97]),
    R = [0.25 / Math.hypot(0.25, 0.97), 0, 0.97 / Math.hypot(0.25, 0.97)]
  near(look(1, view).toward, R, 1e-5)
  // It misses it: its end nearest the ray.
  near(look(1, unitF32([-0.8, 0, 0.6])).toward, unitF32([1, 0, 2]), 1e-5)
  // Along the tube's line: finite, the tube's start.
  assert.ok(look(1, unitF32([-1, 0, 0.0001])).toward.every(Number.isFinite))
  const atLamp = area.capsuleLook([0, 0, 0], [0, 0, 0], 0.5, 0.1, Z, VIEW)
  assert.equal(atLamp.reach, 0, 'at the lamp: no source seen')
  near(area.lineClosest([-1, 2, 0], [2, 0, 0], unitF32([0.25, 1, 0])), [0.5, 2, 0], 1e-5)
  assert.ok(area.lineClosest([-1, 2, 0], [2, 0, 0], [1, 0, 0]).every(Number.isFinite))
})
function near(got: number[], want: number[], tolerance: number) {
  want.forEach((w, i) => assert.ok(Math.abs(got[i] - w) <= tolerance, `${got} against ${want}`))
}

test('a sun lights with its disk: the half vector moves toward the normal, the peak of a polished surface drops by the sphere’s energy, a rough one barely changes', () => {
  // A sun of the default disk (0.5357°, half of it as a radius), kind 2, along the mirror direction of a polished metal.
  const radius = (0.5357 * Math.PI) / 360
  const sun = {
    positionRange: [0, 0, 0, 0],
    params: [kindLane(2), 0, 0, 0],
    shape: [radius, 0, 1, 1],
    capsule: [0, 0, 0, 0],
    traits: [0, 0, Math.sin(radius), 0],
  }
  const lamp = (toward: number[], capsule: boolean) => ({
    toward,
    centre: toward,
    falloff: 1,
    side: toward[2],
    cosine: toward[2],
    wrap: 0,
    lineCos: 1,
    capsule,
  })
  const peak = (rough: number) => {
    const s = metal(rough)
    const disk = area.lampLight(s, Z, VIEW, sun, [0, 0, 0], lamp(MIRROR, true), 1)
    const point = area.lampLight(s, Z, VIEW, sun, [0, 0, 0], lamp(MIRROR, false), 1)
    return disk[0] / point[0]
  }
  // At the mirror direction the half vector is the normal's, the view's cosine on it is 0.8: the lobe keeps its width and loses the
  // energy `a2 / widerAlpha2(a2, sine, VoH)` (`lobeEnergy`), the sine of the disk narrowed by `1 - alpha`.
  const energy = (rough: number) => {
    const a2 = rough ** 4,
      sine = Math.sin(radius) * (1 - rough ** 2)
    return a2 / (a2 + (0.25 * sine * (3 * Math.sqrt(a2) + sine)) / (0.8 + 0.001))
  }
  assert.ok(
    Math.abs(peak(0.05) - energy(0.05)) < 2e-3,
    `a polished surface: the disk lowers the peak (${peak(0.05)} against ${energy(0.05)})`,
  )
  assert.ok(peak(0.6) > 0.95, `a rough one keeps most of it (${peak(0.6)})`)
  assert.ok(Math.abs(peak(0.6) - energy(0.6)) < 2e-3)
  const look = area.lampLook(sun, [0, 0, 0], Z, VIEW, lamp(MIRROR, true))
  near(look.toward, MIRROR, 1e-6)
  near([look.reach, look.soft, look.micro], [Math.sin(radius), 0, 1], 1e-7)
})
