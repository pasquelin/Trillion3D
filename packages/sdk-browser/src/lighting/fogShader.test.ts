// The fog law (#345): a CPU oracle — the linear ramp, and the transmittance of a medium whose
// density falls off with height, integrated numerically along the view ray — against the shipped
// shader text, `FOG_WGSL` run as shipped (`shaderRun`), so a shader edit is what the test sees.
// The extinction form is the old law, mapped to the height law the shader reads; the height fog's
// own fields — opacity, start and cutoff distance, the sun's lobe, the atmosphere's sky and sun —
// are read against the same oracle. With no fog the shader hands the lit colour back untouched.
import test from 'node:test'
import assert from 'node:assert/strict'
import { FOG_WGSL } from './fogShader.ts'
import { DIRECT_LIGHT_WGSL } from './direct/lightWgsl.ts'
import { AIR_BUFFER_STRUCT, VIEW_SLOT } from './atmosphere/layout.ts'
import { LIGHT_BUFFER_AT } from '../frame/backend/state/lightBufferLayout.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import {
  packEnvironment,
  SCENE_ENVIRONMENT_FLOATS,
} from '../../../sdk-core/src/scene/core/environment.ts'
import {
  ATMOSPHERE_SLOT,
  ATMOSPHERE_SLOTS,
} from '../../../sdk-core/src/scene/core/atmospherePack.ts'
import {
  FOG_SLOT,
  FOG_SLOTS,
  packFog,
  type SceneExponentialFog,
  type SceneFog,
  type SceneLinearFog,
} from '../../../sdk-core/src/scene/core/fog.ts'
import type { ResolvedHeightFog } from '../../../sdk-core/src/scene/core/fogHeight.ts'
import { lerp, saturate } from '../../../math/src/scalar/reals.ts'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { near } from '../../../math/src/float/near.fixture.ts'
import { distanceVector3 } from '../../../math/src/vector/vector.ts'

type V3 = [number, number, number]
type OldFog = SceneLinearFog | SceneExponentialFog
/** Points from flat coordinates, three each. */
const points = (flat: number[]) =>
  Array.from({ length: flat.length / 3 }, (_, i) => flat.slice(3 * i, 3 * i + 3) as V3)

/** The oracle: the fog law at `P` seen from `eye`, the optical depth summed over 20 000 steps. */
function oracle(fog: OldFog, eye: V3, P: V3) {
  const d = distanceVector3(P, eye)
  if ('near' in fog) return saturate((fog.far - d) / (fog.far - fog.near))
  const { density, heightFalloff = 0, baseHeight = 0 } = fog
  let tau = 0
  for (let i = 0, n = 20000; i < n; i++) {
    const y = eye[1] + ((i + 0.5) / n) * (P[1] - eye[1])
    tau += density * Math.exp(-heightFalloff * (y - baseHeight)) * (d / n)
  }
  return Math.exp(-tau)
}

/** What the scene gives the fog beside its own block: the sun the light store writes into it, and
 *  an atmosphere's sky radiance and the sun's illuminance on the ground (the contribution 1). */
interface Scene {
  sun?: { toward: V3; luminance: number }
  air?: { sky: V3; ground: V3 }
}
/** The WGSL `fogged` on the contract buffer's fog block, as `packEnvironment` writes it: the
 *  shipped text run by the shared WGSL run; without an `air` the atmosphere's blocks are all zero. */
function wgslFogged(fog: SceneFog | undefined, rgb: V3, P: V3, eye: V3, scene: Scene = {}) {
  const packed = packEnvironment({ exposure: 1, fog }, new Float32Array(SCENE_ENVIRONMENT_FLOATS))
  const at = SCENE_ENVIRONMENT_FLOATS - FOG_SLOTS * 4
  const block = Array.from({ length: FOG_SLOTS }, (_, k) =>
    Array.from(packed.subarray(at + 4 * k, at + 4 * k + 4)),
  )
  const { sun, air } = scene
  if (sun) block[FOG_SLOT.sun] = [...sun.toward, sun.luminance]
  const atmosphere = Array.from({ length: ATMOSPHERE_SLOTS }, () => [0, 0, 0, 0])
  // The view's block as the light buffer declares it.
  const viewSlots = Number(/atmosphereView:array<vec4f,(\d+)>/.exec(AIR_BUFFER_STRUCT)![1])
  const view = Array.from({ length: viewSlots }, () => [0, 0, 0, 0])
  if (air) {
    atmosphere[ATMOSPHERE_SLOT.planet] = [1, 6360, 6420, 0]
    atmosphere[ATMOSPHERE_SLOT.sunIlluminance] = [...air.ground, 1]
    atmosphere[ATMOSPHERE_SLOT.sunTransmittance] = [1, 1, 1, 1]
    view[VIEW_SLOT.haze] = [...air.sky, 0]
  }
  const { fogged } = shaderRun<{ fogged: (rgb: V3, P: V3, eye: V3) => number[] }>(
    FOG_WGSL,
    ['fogged'],
    { directLights: { fog: block, atmosphere, atmosphereView: view } },
  )
  return fogged(rgb, P, eye)
}

const RGB: V3 = [0.8, 0.3, 0.1]
const COLOR: V3 = [0.5, 0.6, 0.7]
const expected = (fog: OldFog, P: V3, eye: V3) => {
  const t = oracle(fog, eye, P)
  return RGB.map((value, i) => lerp(COLOR[i], value, t))
}
/** The shader at every point against the oracle. */
function lawHolds(fog: OldFog, eye: V3, flat: number[]) {
  for (const P of points(flat)) {
    const want = expected(fog, P, eye)
    near(wgslFogged(fog, RGB, P, eye), want, `WGSL ${JSON.stringify({ fog, P })}`, 2e-5)
  }
}

test('linear fog: untouched before near, half-way between, the fog colour alone past far', () => {
  const fog = { color: COLOR, near: 10, far: 110 }
  const eye: V3 = [3, 2, -4]
  lawHolds(fog, eye, [3, 2, 1, 3, 2, 6, 3, 2, 56, 3, 2, 106, 3, 2, 300])
  const half = RGB.map((v, i) => (v + COLOR[i]) / 2)
  near(wgslFogged(fog, RGB, [3, 2, 56], eye), half, 'half', 2e-5)
  near(wgslFogged(fog, RGB, [3, 2, 300], eye), COLOR, 'far', 2e-5)
})

test('exponential fog: exp(−density·d) at every height when nothing falls off', () => {
  const fog = { color: COLOR, density: 0.02 }
  lawHolds(fog, [0, 5, 0], [0, 5, 50, 30, -20, 10, 0, 80, -40])
  const P: V3 = [0, 5, 50]
  near(wgslFogged(fog, RGB, P, [0, 5, 0]), expected(fog, P, [0, 5, 0]), 'e⁻¹', 2e-5)
})

test('height fog: the integrated density, looking level, up and down, from above and below', () => {
  const fog = { color: COLOR, density: 0.08, heightFalloff: 0.35, baseHeight: 1 }
  const some = [40, 2, 0, 40, 2.0001, 0, 10, -3, 30, 5, 25, -5, 0, 1, 200]
  lawHolds(fog, [0, 2, 0], some)
  lawHolds(fog, [0, -4, 0], some)
  // A long ray that barely rises: the mean of the two densities, where the closed form would round.
  lawHolds({ ...fog, density: 0.005 }, [0, 2, 0], [400, 2.0028, 0])
  // High above a steep falloff, the densities underflow and stay finite.
  lawHolds({ ...fog, heightFalloff: 1 }, [0, 400, 0], [0, 0, 10, 300, 1, 0])
  // Deep inside a steep fog, far below its base: the densities pass the cap, the fog stays total.
  lawHolds({ ...fog, heightFalloff: 1 }, [0, -100, 0], [5, -99, 3, 5, -100, 3, 5, -101, 3])
})

test('the extinction form and its height-law spelling read the same pixels', () => {
  // `{ density, heightFalloff }` is mapped exactly — baseDensity = density / (ln 2)², falloff =
  // heightFalloff / ln 2 — so the scenes written with it keep their image.
  const old = { color: COLOR, density: 0.03, heightFalloff: 0.3, baseHeight: 2 }
  const spelled = { color: COLOR, baseDensity: 0.03 / Math.LN2 ** 2, falloff: 0.3 / Math.LN2 }
  for (const P of points([40, 3, 5, 10, -8, 60, 0, 30, 200]))
    near(
      wgslFogged({ ...spelled, baseHeight: 2 }, RGB, P, [0, 1, 0]),
      wgslFogged(old, RGB, P, [0, 1, 0]),
      `spelling ${P}`,
      1e-6,
    )
})

/** A height fog with every field set, away from the defaults, and the sun it scatters. */
const HEIGHT: ResolvedHeightFog = {
  color: [0.1, 0.2, 0.3],
  baseDensity: 0.01,
  falloff: 0.05,
  baseHeight: 3,
  maxOpacity: 0.9,
  startDistance: 20,
  cutoffDistance: 500,
  directional: { exponent: 3, startDistance: 60, color: [0.4, 0.2, 0.1] },
  skyContribution: [1, 0.5, 0.25],
}
const SUN = { toward: [0.6, 0.8, 0] as V3, luminance: 5 }

/** The shader's `fogged` of `RGB` through a height fog by numerical integration, step by step: `(ln
 *  2)²` times the density summed from the start distance to the point is the optical depth, `T =
 *  exp(−depth)` held to `1 − maxOpacity`; the sun's lobe crosses the mean density of that stretch
 *  from its own start distance on; there is none past the cutoff. The fog adds `color · (1 − T)`
 *  and the lobe; `sky` is what an atmosphere adds to the colour, `ground` to the lobe's. */
function heightLaw(fog: ResolvedHeightFog, eye: V3, P: V3, sky = [0, 0, 0], ground = [0, 0, 0]) {
  const d = distanceVector3(P, eye)
  if (fog.cutoffDistance > 0 && d > fog.cutoffDistance) return RGB
  const reach = Math.max(d - fog.startDistance, 0)
  let sum = 0
  for (let i = 0, n = 20000; i < n; i++) {
    const y = eye[1] + ((fog.startDistance + ((i + 0.5) / n) * reach) / d) * (P[1] - eye[1])
    sum += fog.baseDensity * 2 ** (-fog.falloff * (y - fog.baseHeight)) * (reach / n)
  }
  const depth = Math.LN2 ** 2 * sum
  const kept = Math.max(Math.exp(-depth), 1 - fog.maxOpacity)
  const lobeDepth = (depth * Math.max(reach - fog.directional.startDistance, 0)) / (reach || 1)
  const cosine = Math.max(
    0,
    [0, 1, 2].reduce((a, i) => a + ((P[i] - eye[i]) / d) * SUN.toward[i], 0),
  )
  const lobe = (cosine ** fog.directional.exponent * (1 - Math.exp(-lobeDepth))) / (4 * Math.PI)
  return RGB.map((v, c) => {
    const colour = fog.color[c] + sky[c] * fog.skyContribution[c]
    return (
      v * kept + colour * (1 - kept) + (fog.directional.color[c] * SUN.luminance + ground[c]) * lobe
    )
  })
}

test('height fog: every field of the law, against the integrated density', () => {
  const eye: V3 = [0, 4, 0]
  // Nearer than the start distance, past it short of the lobe's, beyond the lobe's start toward the sun.
  for (const P of points([10, 4, 0, 60, 5, 0, 300, 40, 80, 200, -6, -120, 0, 60, 400]))
    near(wgslFogged(HEIGHT, RGB, P, eye, { sun: SUN }), heightLaw(HEIGHT, eye, P), `${P}`, 5e-5)
  // Past the cutoff there is no fog at all: the lit colour as it is.
  near(wgslFogged(HEIGHT, RGB, [600, 4, 0], eye, { sun: SUN }), RGB, 'cutoff', 0)
  // The opacity stops at its maximum: a very dense fog leaves 10 % of the lit colour.
  const dense = { ...HEIGHT, baseDensity: 5, startDistance: 0, cutoffDistance: 0 }
  const P: V3 = [200, 4, 0]
  near(wgslFogged(dense, RGB, P, eye, { sun: SUN }), heightLaw(dense, eye, P), 'opaque', 5e-5)
  near(
    wgslFogged({ ...dense, color: [0, 0, 0] }, RGB, P, eye),
    RGB.map((v) => v * 0.1),
    'max',
    5e-5,
  )
})

test('height fog: an atmosphere adds the sky’s radiance and the sun’s ground light to the fog’s own', () => {
  const eye: V3 = [0, 4, 0]
  const air = { sky: [0.2, 0.3, 0.5] as V3, ground: [4, 3, 2] as V3 }
  for (const P of points([300, 40, 80, 60, 5, 0]))
    near(
      wgslFogged(HEIGHT, RGB, P, eye, { sun: SUN, air }),
      heightLaw(HEIGHT, eye, P, air.sky, air.ground),
      `air ${P}`,
      5e-5,
    )
  // The default fog — black, the sky white, no start — takes all its colour from the sky.
  const plain: ResolvedHeightFog = {
    ...HEIGHT,
    startDistance: 0,
    color: [0, 0, 0],
    skyContribution: [1, 1, 1],
    directional: { ...HEIGHT.directional, color: [0, 0, 0] },
  }
  const P: V3 = [0, 4, 400]
  const got = wgslFogged(plain, RGB, P, eye, { sun: SUN, air })
  near(got, heightLaw(plain, eye, P, air.sky, air.ground), 'sky colour', 5e-5)
  const dry = wgslFogged(plain, RGB, P, eye, { sun: SUN })
  assert.ok(
    got.every((v, i) => v > dry[i] + 0.05),
    'the sky gives the black fog its colour',
  )
})

test('the default height fog: the declared defaults, converted, against the integral', () => {
  // The reference's 0.02 and 0.2, per 1000 centimetres, are 0.002 and 0.02 per metre.
  const defaults: ResolvedHeightFog = {
    color: [0, 0, 0],
    baseDensity: 0.02 / 10,
    falloff: 0.2 / 10,
    baseHeight: 0,
    maxOpacity: 1,
    startDistance: 0,
    cutoffDistance: 0,
    directional: { exponent: 4, startDistance: 10000 / 100, color: [0, 0, 0] },
    skyContribution: [1, 1, 1],
  }
  const eye: V3 = [0, 2, 0]
  for (const P of points([500, 2, 0, 2000, 30, 100, 0, 300, 40]))
    near(wgslFogged({}, RGB, P, eye), heightLaw(defaults, eye, P), `default ${P}`, 5e-5)
  // The uniform medium: a falloff of 0 extinguishes at (ln 2)² · baseDensity per metre.
  const flat = wgslFogged({ baseDensity: 0.01, falloff: 0 }, RGB, [100, 2, 0], eye)
  near(
    flat,
    RGB.map((v) => v * Math.exp(-(Math.LN2 ** 2) * 0.01 * 100)),
    'uniform',
    5e-6,
  )
})

test('no fog: the shader hands the lit colour back as it is, the block all zero', () => {
  const block = packFog(undefined, new Float32Array(FOG_SLOTS * 4).fill(9), 0)
  assert.deepEqual(Array.from(block), new Array(FOG_SLOTS * 4).fill(0))
  for (const P of points([0, 0, 5, 1e4, -300, 2]))
    assert.deepEqual(wgslFogged(undefined, RGB, P, [0, 1, 0]), RGB)
})

/** The byte offset of each member of the structure `name` in `text`: words and arrays of the three
 *  sizes the light buffer holds. */
function offsetsOf(text: string, name: string) {
  const body = new RegExp(`struct ${name}\\{([^}]*)\\}`).exec(text)![1]
  const size: Record<string, number> = { vec4f: 16, vec2u: 8, DirectLight: 80 }
  const at: Record<string, number> = {}
  let offset = 0
  for (const [, member, , type, count] of body.matchAll(/(\w+):(u32|array<(\w+),?(\d*)>)/g)) {
    at[member] = offset
    offset += type ? size[type] * Number(count || 1) : 4
  }
  return at
}

test('the light buffer’s regions sit where the lighting, the air’s programs and the CPU read them', () => {
  const lights = offsetsOf(wgslModule(DIRECT_LIGHT_WGSL), 'DirectLights')
  const air = offsetsOf(AIR_BUFFER_STRUCT, 'AirBuffer')
  assert.equal(lights.sky, LIGHT_BUFFER_AT.sky)
  assert.equal(lights.atmosphere, LIGHT_BUFFER_AT.atmosphere)
  assert.equal(lights.ltc, LIGHT_BUFFER_AT.ltc)
  assert.equal(lights.items, LIGHT_BUFFER_AT.items)
  // The air's programs read the front of the same bytes, by the same names — the fog and the sky's
  // block the sky's draw reads the fog through —, its block, the view's, the haze volume and the
  // sky by direction, which they write.
  assert.equal(air.fog, lights.fog)
  assert.equal(air.sky, lights.sky)
  assert.equal(air.atmosphere, lights.atmosphere)
  assert.equal(air.atmosphereView, lights.atmosphereView)
  assert.equal(air.aerial, lights.aerial)
  assert.equal(air.skyRays, lights.skyRays)
})
