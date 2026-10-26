// The local fog volumes' tests' common ground (`fogLocal.test.ts`): the block of the light buffer the
// plan writes (`planLocalFog`) as the `vec4f` slots the shipped shader text reads it, that text run as
// shipped (`shaderRun`) on it, and the oracle — the same law integrated step by step along the ray.
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import {
  resolveLocalFogVolume,
  type SceneLocalFogVolume,
} from '../../../sdk-core/src/scene/localFog/contracts.ts'
import { localFogLimits } from '../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import { fogWgsl } from './fogShader.ts'
import { DEFAULT_SETTINGS, camera } from './fogVolumeRun.fixture.ts'
import { fogRun } from './fogShaderRun.fixture.ts'
import { FOG_LOCAL_MEDIUM_WGSL } from './fog/localWgsl.ts'
import { planLocalFog, type LocalFogPlanSettings, type LocalFogView } from './fog/localPlan.ts'
import { LOCAL_FOG_FLOATS, LOCAL_FOG_SLOT } from './fog/localLayout.ts'
import type { LocalFogTiling } from './fog/localTiling.ts'
import { fogTilesWgsl } from './fog/localWgsl.ts'
import type { Vec3 as V3 } from '../../../math/src/vector/vectorTuple.ts'

/** The view of the tests: a camera at the origin's height 2, looking down −z. */
export const VIEW = camera([0, 2, 0])
export const EYE = VIEW.eye as V3
const LOOKING: LocalFogView = {
  eye: VIEW.eye,
  viewProj: VIEW.viewProj,
  near: VIEW.near,
  size: [VIEW.width, VIEW.height],
}

/** The run's settings as the plan holds them, the defaults but for `more` and the view's start distance,
 *  0 so that the volumes near the eye show (the default is 10 metres). */
export const planSettings = (more: Partial<LocalFogPlanSettings> = {}): LocalFogPlanSettings => {
  const { tileSize, ...limits } = localFogLimits(DEFAULT_SETTINGS)
  void tileSize
  return { inVolume: true, onTranslucent: false, ...limits, startDistance: 0, ...more }
}

/** A volume placed at `at`, its matrix a translation scaled by `scale`. */
export const placed = (
  id: string,
  at: V3,
  more: Partial<SceneLocalFogVolume> & { scale?: number } = {},
): SceneLocalFogVolume => {
  const { scale = 1, ...rest } = more
  return {
    id,
    matrix: [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, ...at, 1],
    ...rest,
  }
}

/** The block of the light buffer the plan writes for `volumes` seen from the test view, as the slots the
 *  shader reads, the sun's light and direction toward it, and the sky light's three rows; the view
 *  tiled by `tiling` where one is given. */
export function localSlots(
  volumes: SceneLocalFogVolume[],
  {
    sun = { light: [0, 0, 0], toward: [0, 1, 0] },
    sky = [],
    settings = planSettings(),
    view = LOOKING,
    tiling,
  }: {
    sun?: { light: number[]; toward: number[] } | null
    sky?: number[][]
    settings?: LocalFogPlanSettings
    view?: LocalFogView
    tiling?: LocalFogTiling
  } = {},
) {
  const out = new Float32Array(LOCAL_FOG_FLOATS)
  const count = planLocalFog(
    out,
    volumes.map(resolveLocalFogVolume),
    view,
    sun ?? undefined,
    settings,
    tiling,
  )
  sky.forEach((row, k) => out.set(row, (LOCAL_FOG_SLOT.sky + k) * 4))
  return {
    count,
    slots: Array.from({ length: LOCAL_FOG_FLOATS / 4 }, (_, i) =>
      Array.from(out.subarray(4 * i, 4 * i + 4)),
    ),
  }
}

/** The resources the fog's volume gives the programs, stubbed: it covers `excluded` metres of the near air
 *  along every ray (0: it covers none) and lets `lookup` — its light and its transmittance — be laid over
 *  everything behind it (by default none: no light, all let through); the lists' buffer is declared. */
export function volumeStub(excluded = 0, lookup = [0, 0, 0, 1]) {
  const decl = wgslBlock(
    'localTestResources',
    [fogTilesWgsl({ group: 0, tiles: 1 })],
    `fn fogVolumeExclude(toward:vec3f)->f32{return ${excluded.toFixed(6)};}
fn fogVolumeLookup(toward:vec3f)->vec4f{return vec4f(${lookup.map((c) => c.toFixed(6)).join(',')});}
fn fogCubeSharp(direction:vec3f)->vec3f{return vec3f(1.0);}
fn fogCubeAverage(direction:vec3f)->vec3f{return vec3f(1.0);}
fn fogSkyLightStrength()->f32{return 0.0;}
fn fogSkyLightColour(direction:vec3f)->vec3f{return vec3f(0.0);}
fn lightShaftMask(pixel:vec2f)->f32{return 1.0;}`,
  )
  return { block: fogWgsl(decl), scope: {} }
}

type Over = { localFogOver: (toward: V3, pixel: number[]) => number[] }
/** The shipped `localFogOver` on the slots `slots` and the tile words `tiles` (none: the view is not tiled),
 *  where the fog's volume covers `excluded` metres of the near air along every ray (0: it covers none):
 *  the volumes over the ray to a point, seen in the pixel `pixel` (the view's corner by default). */
export function overOf(slots: number[][], excluded = 0, tiles: number[] = []) {
  const run = fogRun<Over>(undefined, ['localFogOver'], {
    localFog: slots,
    localFogTiles: tiles,
    resources: volumeStub(excluded),
  }).localFogOver
  return (toward: V3, pixel = [0, 0]) => run(toward, pixel)
}

/** The shipped `localFogMedium` on `slots` and the tile words `tiles` (none: the view is not tiled), for
 *  the cell at `position` from the eye, its back and front `back` and `front` metres from it. */
export function mediumOf(slots: number[][], tiles: number[] = []) {
  const run = shaderRun<{
    localFogMedium: (p: V3, back: number, front: number) => { [name: string]: unknown }
  }>(
    wgslProgram('', [FOG_LOCAL_MEDIUM_WGSL, fogTilesWgsl({ group: 0, tiles: 1 })]),
    ['localFogMedium'],
    { directLights: { localFog: slots }, localFogTiles: tiles },
  )
  return (position: V3, back: number, front: number) => {
    const { scattering, extinction, emissive } = run.localFogMedium(position, back, front) as {
      scattering: number[]
      extinction: number
      emissive: number[]
    }
    return { scattering, extinction, emissive }
  }
}

const unit = (v: number[]) => {
  const l = Math.hypot(...v)
  return v.map((c) => c / l)
}

/**
 * The coverage of a volume along the ray from the eye to `toward`, its law integrated by `steps` midpoints:
 * the radial density `0.75 · radial · (1 − d²)` and the height density `height · e^(−falloff · (h − offset))`
 * in the volume's unit space, over the stretch the sphere, the start distance `start` and the ray's end
 * leave, from `excluded` on; combined by `1 − (1 − Tr)(1 − Th)`, its optical depth carried to metres by the
 * radius. The height axis is up.
 */
export function coverageOracle(
  volume: SceneLocalFogVolume,
  toward: V3,
  { start = 0, excluded = 0, steps = 20000 } = {},
) {
  const v = resolveLocalFogVolume(volume)
  const radius = 5 * Math.max(...[0, 4, 8].map((k) => Math.hypot(...v.matrix.slice(k, k + 3))))
  const centre = [v.matrix[12], v.matrix[13], v.matrix[14]]
  const length = Math.hypot(...toward)
  const dir = unit([...toward])
  const origin = EYE.map((c, i) => c - centre[i])
  const b = dir.reduce((s, c, i) => s + c * origin[i], 0)
  const c = origin.reduce((s, x) => s + x * x, 0) - radius * radius
  const h = b * b - c
  if (h < 0) return 0
  const first = Math.max(-b - Math.sqrt(h), start, excluded, 0)
  const last = Math.min(-b + Math.sqrt(h), length)
  if (last <= first) return 0
  const falloff = Math.max(v.heightFalloff, 1) * 0.01
  let radial = 0,
    height = 0
  const step = (last - first) / steps
  for (let i = 0; i < steps; i++) {
    const t = first + (i + 0.5) * step
    const p = origin.map((o, k) => (o + dir[k] * t) / radius)
    radial +=
      0.75 *
      v.radialDensity *
      Math.max(0, 1 - (p[0] ** 2 + p[1] ** 2 + p[2] ** 2)) *
      (step / radius)
    height += v.heightDensity * Math.exp(-falloff * (p[1] - v.heightOffset)) * (step / radius)
  }
  const kept = 1 - (1 - Math.exp(-radial)) * (1 - Math.exp(-height))
  return 1 - kept ** radius
}
