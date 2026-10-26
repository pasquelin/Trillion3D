// The fog tests' common ground (`fogShader.test.ts`, `fogLayers.test.ts`, `fogVolume.test.ts`):
// the CPU oracle of the law, and the shipped shader text (the fog over no resources, or the fog over the
// resources a test names) run as shipped (`shaderRun`) on the fog block `packEnvironment` writes,
// so a shader edit is what a test sees.
import { fogBlockOf } from './fog/readWgsl.ts'
import { FOG_VIEW_SLOTS } from './fog/viewSlots.ts'
import { LOCAL_FOG_SLOTS } from './fog/localLayout.ts'
import { AIR_BUFFER_STRUCT, VIEW_SLOT } from './atmosphere/layout.ts'
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
  type SceneExponentialFog,
  type SceneFog,
  type SceneLinearFog,
} from '../../../sdk-core/src/scene/core/fog.ts'
import type { ResolvedHeightFog } from '../../../sdk-core/src/scene/core/fogHeight.ts'
import type { WgslDecl } from '../../../math/src/wgsl/decl.ts'
import { lerp, saturate } from '../../../math/src/scalar/reals.ts'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { near } from '../../../math/src/float/near.fixture.ts'
import { distanceVector3 } from '../../../math/src/vector/vector.ts'
import type { Vec3 as V3 } from '../../../math/src/vector/vectorTuple.ts'

export { near }

/** `count` `vec4f` slots, all zero. */
const zeroSlots = (count: number) => Array.from({ length: count }, () => [0, 0, 0, 0])

export type { V3 }
export type OldFog = SceneLinearFog | SceneExponentialFog
/** Points from flat coordinates, three each. */
export const points = (flat: number[]) =>
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
export interface Scene {
  sun?: { toward: V3; luminance: number }
  /** The air: its sky's radiance, the sun's illuminance on the ground, and a second light's — its
   *  direction toward it and its illuminance on the ground. */
  air?: { sky: V3; ground: V3; second?: { toward: V3; ground: V3 } }
  /** What the program binds past the light buffer: the fog's module over the declaration that answers
   *  the cubemap and the volume (`fogBlockOf`), and the names it reads in the scope (a fake texture, a fake uniform). */
  resources?: { block: WgslDecl; scope: object }
  /** The volume's view block in the light buffer (`directLights.fogView`, `FOG_VIEW_SLOT`): the
   *  `vec4f` slots a surface reads its cell from; zero where none. */
  fogView?: number[][]
  /** The local fog volumes' block in the light buffer (`directLights.localFog`, `LOCAL_FOG_SLOT`): zero
   *  where none. */
  localFog?: number[][]
  /** The words of the tiles' lists (`localFogTiles`, a binding of its own): none where the view is not tiled. */
  localFogTiles?: number[]
}
/** The functions `names` of the shipped fog text run on the contract buffer's fog block, as
 *  `packEnvironment` writes it; without an `air` the atmosphere's blocks are all zero. */
export function fogRun<T>(fog: SceneFog | undefined, names: string[], scene: Scene = {}) {
  const packed = packEnvironment({ exposure: 1, fog }, new Float32Array(SCENE_ENVIRONMENT_FLOATS))
  const at = SCENE_ENVIRONMENT_FLOATS - FOG_SLOTS * 4
  const block = Array.from({ length: FOG_SLOTS }, (_, k) =>
    Array.from(packed.subarray(at + 4 * k, at + 4 * k + 4)),
  )
  const {
    sun,
    air,
    resources,
    fogView = zeroSlots(FOG_VIEW_SLOTS),
    localFog = zeroSlots(LOCAL_FOG_SLOTS),
    localFogTiles = [],
  } = scene
  if (sun) block[FOG_SLOT.sun] = [...sun.toward, sun.luminance]
  const atmosphere = Array.from({ length: ATMOSPHERE_SLOTS }, () => [0, 0, 0, 0])
  // The view's block as the light buffer declares it.
  const viewSlots = Number(/atmosphereView:array<vec4f,(\d+)>/.exec(AIR_BUFFER_STRUCT)![1])
  const view = zeroSlots(viewSlots)
  if (air) {
    atmosphere[ATMOSPHERE_SLOT.planet] = [1, 6360, 6420, 0]
    atmosphere[ATMOSPHERE_SLOT.sunIlluminance] = [...air.ground, 1]
    atmosphere[ATMOSPHERE_SLOT.sunTransmittance] = [1, 1, 1, 1]
    view[VIEW_SLOT.haze] = [...air.sky, 0]
    if (air.second) {
      atmosphere[ATMOSPHERE_SLOT.secondDirection] = [...air.second.toward, 1]
      atmosphere[ATMOSPHERE_SLOT.secondIlluminance] = [...air.second.ground, 0]
      atmosphere[ATMOSPHERE_SLOT.secondDisk] = [0, 0, 0, 1]
      atmosphere[ATMOSPHERE_SLOT.secondTransmittance] = [1, 1, 1, 0]
    }
  }
  return shaderRun<T>(resources ? resources.block : fogBlockOf({ group: 0 }), names, {
    directLights: {
      fog: block,
      atmosphere,
      atmosphereView: view,
      fogView,
      localFog,
    },
    localFogTiles,
    ...resources?.scope,
  })
}

/** The WGSL `fogged` of `rgb` at `P` seen from `eye` (`fogRun`), in the pixel `pixel` (the view's corner
 *  by default: the fog this runs on holds no local fog volume). */
export function wgslFogged(
  fog: SceneFog | undefined,
  rgb: V3,
  P: V3,
  eye: V3,
  scene: Scene = {},
  pixel = [0, 0],
) {
  const { fogged } = fogRun<{ fogged: (rgb: V3, P: V3, eye: V3, pixel: number[]) => number[] }>(
    fog,
    ['fogged'],
    scene,
  )
  return fogged(rgb, P, eye, pixel)
}

export const RGB: V3 = [0.8, 0.3, 0.1]
export const COLOR: V3 = [0.5, 0.6, 0.7]
export const expected = (fog: OldFog, P: V3, eye: V3) => {
  const t = oracle(fog, eye, P)
  return RGB.map((value, i) => lerp(COLOR[i], value, t))
}
/** The shader at every point against the oracle. */
export function lawHolds(fog: OldFog, eye: V3, flat: number[]) {
  for (const P of points(flat)) {
    const want = expected(fog, P, eye)
    near(wgslFogged(fog, RGB, P, eye), want, `WGSL ${JSON.stringify({ fog, P })}`, 2e-5)
  }
}

/** A height fog with every field set, away from the defaults, and the sun it scatters. */
export const HEIGHT: ResolvedHeightFog = {
  color: [0.1, 0.2, 0.3],
  baseDensity: 0.01,
  falloff: 0.05,
  baseHeight: 3,
  maxOpacity: 0.9,
  startDistance: 20,
  cutoffDistance: 500,
  directional: { exponent: 3, startDistance: 60, color: [0.4, 0.2, 0.1] },
  skyContribution: [1, 0.5, 0.25],
  second: { baseDensity: 0, falloff: 0.02, heightShift: 0 },
  horizontalLimit: 0,
  inMainView: true,
  inSkyCapture: true,
  inReflectionCaptures: true,
  holdout: false,
  skyLightScattering: { strength: 0, roughness: 0.15 },
}
export const SUN = { toward: [0.6, 0.8, 0] as V3, luminance: 5 }

/** The shader's `fogged` of `RGB` through a height fog by numerical integration, step by step: `(ln
 *  2)²` times the density summed from the start distance to the point is the optical depth, `T =
 *  exp(−depth)` held to `1 − maxOpacity`; the sun's lobe crosses the mean density of that stretch
 *  from its own start distance on; there is none past the cutoff. The fog adds `color · (1 − T)`
 *  and the lobe; `sky` is what an atmosphere adds to the colour, `ground` to the lobe's. */
export function heightLaw(
  fog: ResolvedHeightFog,
  eye: V3,
  P: V3,
  sky = [0, 0, 0],
  ground = [0, 0, 0],
) {
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
