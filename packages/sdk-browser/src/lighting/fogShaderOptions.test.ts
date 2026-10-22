// The fog-wide switches the view block carries (`FOG_VIEW_SLOT.options`, `observer`, `match`,
// `albedo`) against the shipped fog text (`fogShaderRun.fixture.ts`): no fog at all, the atmosphere's
// light left out of the fog, the fog made to match the volume, and an orthographic view measuring the
// fog from its own height. Split from `fogShader.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { subtract, unit } from '../../../math/src/vector/vectorTuple.ts'
import { FOG_VIEW_SLOT, FOG_VIEW_SLOTS } from './fog/viewSlots.ts'
import type { ResolvedHeightFog } from '../../../sdk-core/src/scene/core/fogHeight.ts'
import { fogResourcesWgsl } from './fog/readWgsl.ts'
import { phase } from './fogVolumeRun.fixture.ts'
import {
  HEIGHT,
  RGB,
  SUN,
  fogRun,
  heightLaw,
  near,
  wgslFogged,
  type V3,
} from './fogShaderRun.fixture.ts'

/** The view block with the switches `options` (fog off, sky left out, matches, ortho), the observer, the
 *  volume's glow and anisotropy, and its particle colour. */
const view = (
  options: number[],
  { observer = [0, 0, 0, 0], match = [0, 0, 0, 0], albedo = [0, 0, 0, 0] } = {},
) => ({
  fogView: Array.from({ length: FOG_VIEW_SLOTS }, (_, k) =>
    k === FOG_VIEW_SLOT.options
      ? options
      : k === FOG_VIEW_SLOT.observer
        ? observer
        : k === FOG_VIEW_SLOT.match
          ? match
          : k === FOG_VIEW_SLOT.albedo
            ? albedo
            : [0, 0, 0, 0],
  ),
})
const AIR = { sky: [0.2, 0.3, 0.5] as V3, ground: [4, 3, 2] as V3 }
const EYE: V3 = [0, 4, 0]

test('a view that draws no fog leaves the colour, the sky’s ray and the background as they are, with an atmosphere too', () => {
  const none = view([1, 0, 0, 0])
  const P: V3 = [300, 40, 80]
  assert.deepEqual(wgslFogged(HEIGHT, RGB, P, EYE, { sun: SUN, air: AIR, ...none }), RGB)
  assert.notDeepEqual(wgslFogged(HEIGHT, RGB, P, EYE, { sun: SUN, air: AIR }), RGB, 'it does')
  type Beyond = {
    fogBeyond: (dir: V3, eye: V3) => number[]
    fogsBackground: () => boolean
    fogOver: (P: V3, eye: V3) => number[]
  }
  const run = (scene: object) =>
    fogRun<Beyond>(HEIGHT, ['fogBeyond', 'fogsBackground', 'fogOver'], scene)
  const dir = unit([1, 0.2, 0.5]) as V3
  assert.deepEqual(run({ sun: SUN, ...none }).fogBeyond(dir, EYE), [0, 0, 0, 1])
  assert.deepEqual(run({ sun: SUN, ...none }).fogOver(P, EYE), [0, 0, 0, 1])
  assert.equal(run({ sun: SUN }).fogsBackground(), true)
  assert.equal(run({ sun: SUN, ...none }).fogsBackground(), false)
})

test('an atmosphere that does not add to the fog leaves it its own colour and its lobe not divided over the sphere', () => {
  const left = view([0, 1, 0, 0])
  const dark = { ...HEIGHT, directional: { ...HEIGHT.directional, color: [0, 0, 0] as V3 } }
  for (const P of [
    [300, 40, 80],
    [60, 5, 0],
  ] as V3[]) {
    const bare = heightLaw(dark, EYE, P)
    // The fog's own lobe, undivided: what the lobe of the divided law adds, times the sphere.
    const lobe = heightLaw(HEIGHT, EYE, P).map((v, c) => v - heightLaw(dark, EYE, P)[c])
    const want = bare.map((v, c) => v + lobe[c] * 4 * Math.PI)
    near(wgslFogged(HEIGHT, RGB, P, EYE, { sun: SUN, air: AIR, ...left }), want, `${P}`, 1e-4)
  }
  // The atmosphere's colour and ground light add where it does, and not otherwise.
  const P: V3 = [300, 40, 80]
  const added = wgslFogged(dark, RGB, P, EYE, { sun: SUN, air: AIR })
  const without = wgslFogged(dark, RGB, P, EYE, { sun: SUN, air: AIR, ...left })
  assert.ok(added.some((v, c) => Math.abs(v - without[c]) > 1e-3))
  // Its haze over the surfaces is the air's own, and stays: the fog's transmittance times the haze's.
  type Over = { fogOver: (P: V3, eye: V3) => number[] }
  const over = (haze: number[], scene: object) =>
    fogRun<Over>(HEIGHT, ['fogOver'], {
      sun: SUN,
      air: AIR,
      resources: {
        decl: fogResourcesWgsl({ group: 0 }),
        scope: { aerialPerspective: () => haze },
      },
      ...scene,
    }).fogOver(P, EYE)
  const clear = over([0, 0, 0, 1], left)
  near([over([0.1, 0.1, 0.1, 0.5], left)[3]], [clear[3] * 0.5], 'haze', 1e-6)
})

test('a fog made to match the volume: its colour the volume’s glow, its lobe the volume’s phase from the start, its light times the particles’ colour', () => {
  // A uniform fog from the eye: nothing starts later, nothing falls off, the opacity is not held.
  const flat: ResolvedHeightFog = {
    ...HEIGHT,
    baseDensity: 0.01,
    falloff: 0,
    startDistance: 0,
    cutoffDistance: 0,
    maxOpacity: 1,
    skyContribution: [1, 0.5, 0.25],
  }
  const glow = [0.3, 0.2, 0.1]
  const albedo = [0.9, 0.6, 0.3]
  const g = 0.4
  const matched = view([0, 0, 1, 0], { match: [...glow, g], albedo })
  const P: V3 = [40, 10, 30]
  const ray = subtract(P, EYE)
  const length = Math.hypot(...ray)
  const kept = Math.exp(-(Math.LN2 ** 2) * 0.01 * length)
  const toEye = unit(ray).map((c) => -c)
  const lobe = phase(g, SUN.toward, toEye) * (1 - kept)
  const want = RGB.map(
    (v, c) =>
      v * kept +
      (glow[c] + AIR.sky[c] * flat.skyContribution[c] * albedo[c]) * (1 - kept) +
      AIR.ground[c] * lobe * albedo[c],
  )
  near(wgslFogged(flat, RGB, P, EYE, { sun: SUN, air: AIR, ...matched }), want, 'matched', 1e-5)
  // No atmosphere: the volume's colour alone, and the fog's own lobe — black — adds none.
  const alone = RGB.map((v, c) => v * kept + glow[c] * (1 - kept))
  near(wgslFogged(flat, RGB, P, EYE, { sun: SUN, ...matched }), alone, 'alone', 1e-5)
})

test('an orthographic view that measures the fog from its own height takes the observer’s limit from it', () => {
  // A view 2 000 m up, the fog's base at 3: the observer may rise as high as the view's height, not 655 m.
  const fog: ResolvedHeightFog = {
    ...HEIGHT,
    baseDensity: 0.01,
    falloff: 0.001,
    baseHeight: 3,
    startDistance: 0,
    cutoffDistance: 0,
    maxOpacity: 1,
    directional: { ...HEIGHT.directional, color: [0, 0, 0] },
  }
  const eye: V3 = [0, 2000, 0]
  const P: V3 = [100, 1990, 0]
  const ray = subtract(P, eye)
  const length = Math.hypot(...ray)
  const rise = fog.falloff * ray[1]
  const thickness = (origin: number) =>
    fog.baseDensity * 2 ** (-fog.falloff * (origin - fog.baseHeight)) * ((1 - 2 ** -rise) / rise)
  const ortho = view([0, 0, 0, 1], { observer: [2000 - 655.36, 0, 0, 0] })
  const kept = 2 ** (-thickness(eye[1] + fog.baseHeight) * length)
  const got = wgslFogged(fog, RGB, P, eye, ortho)
  near(
    got,
    RGB.map((v, c) => v * kept + fog.color[c] * (1 - kept)),
    'from its height',
    1e-5,
  )
  // The same view as a perspective one is held at 655 m above the base, its ray compensated.
  const held = wgslFogged(fog, RGB, P, eye)
  assert.ok(
    held.some((v, c) => Math.abs(v - got[c]) > 1e-3),
    'the observer is held lower',
  )
})
