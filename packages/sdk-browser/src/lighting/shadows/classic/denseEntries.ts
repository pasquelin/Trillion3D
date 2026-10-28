import { VSM_UNIT_PER_CM, VSM_CM_PER_UNIT } from '../vsm/constants.ts'
import {
  DEFAULT_SUN_CASCADES,
  cascadeCount,
  cascadeRange,
  cascadeSphere,
  type SunCascadeSettings,
  type ViewCascadeSettings,
} from './cascadeSplits.ts'
import { localMip, sunLevelIndex } from './denseLevels.ts'

/**
 * THE PAGES A CLASSIC SHADOW MAP DRAWS (`shadowVirtualEnable` off), as the entries the dense marking asks for (`vsmMarkDense`, `markingPass.ts`): a map of fixed resolution
 * whose every page is resident, drawn again each image. A sun's cascade is the clipmap level whose texels are the nearest at or above those the cascade's resolution would
 * give, and the pages of that level its bounding sphere covers; a local light's map is the one mip of its map whose texels are the nearest at or under its resolution, every page.
 * The texels land on the pages' grid, so a cascade has between half and all of the resolution asked: the pool's pages are what the dense maps cost, and a level of the clipmap is the only map a sun's cascade can draw in.
 */

/** The entries one frame holds: more are left out. */
export const DENSE_MAX_ENTRIES = 256
/** The words of an entry: the sphere's centre (three floats) and radius, the map, the mip, the kind (`VSM_DENSE_KIND`) and a spare. */
export const DENSE_ENTRY_WORDS = 8
const KIND_SPHERE = 0
const KIND_WHOLE = 1

/** A sun whose clipmap's maps are `levelCount` from the id `firstId`, the first of them the absolute level `firstLevel`. */
export interface DenseSun {
  readonly firstId: number
  readonly firstLevel: number
  readonly levelCount: number
  readonly settings?: SunCascadeSettings
}

/** A local light's `mapCount` maps from the id `firstId`, drawn at `resolution` texels a side. */
export interface DenseLocal {
  readonly firstId: number
  readonly mapCount: number
  readonly resolution: number
}

/** The view's axes, in the world's units: where it looks, the tangents of its half fields, its near plane (centimetres). */
export interface DenseCamera {
  readonly perspective: boolean
  readonly forward: ArrayLike<number>
  readonly tanX: number
  readonly tanY: number
}

type PutEntry = (
  kind: number,
  mapId: number,
  mip: number,
  x: number,
  y: number,
  z: number,
  radius: number,
) => void

/** The entries of a sun's cascades: each a sphere at its depth along the view's axis, in the clipmap level its texels fit. */
function putSunCascades(
  put: PutEntry,
  sun: DenseSun,
  camera: DenseCamera,
  view: ViewCascadeSettings,
  maxCascadeResolution: number,
) {
  const settings = sun.settings ?? DEFAULT_SUN_CASCADES
  for (let k = 0, n = cascadeCount(settings, view); k < n; k++) {
    const range = cascadeRange(settings, view, k)
    const sphere = cascadeSphere(range.near, range.far, camera.tanX, camera.tanY)
    const level = sunLevelIndex(sphere.radius, maxCascadeResolution, sun.firstLevel, sun.levelCount)
    const along = sphere.depth * VSM_UNIT_PER_CM
    put(
      KIND_SPHERE,
      sun.firstId + level,
      0,
      camera.forward[0]! * along,
      camera.forward[1]! * along,
      camera.forward[2]! * along,
      sphere.radius * VSM_UNIT_PER_CM,
    )
  }
}

/** The entries of a local light's maps, each whole at the mip its resolution fits. */
function putLocalMaps(put: PutEntry, light: DenseLocal) {
  if (!(light.resolution >= 1)) return
  const mip = localMip(light.resolution)
  for (let face = 0; face < light.mapCount; face++)
    put(KIND_WHOLE, light.firstId + face, mip, 0, 0, 0, 0)
}

/**
 * Writes the entries of the frame's classic maps into `words` (and `floats`, its view as floats) and returns their count: for each sun the cascades the view and the sun's
 * settings give, for each local light its maps. An orthographic view draws no cascade.
 */
export function writeDenseEntries(
  words: Uint32Array,
  floats: Float32Array,
  suns: readonly DenseSun[],
  locals: readonly DenseLocal[],
  camera: DenseCamera,
  view: ViewCascadeSettings,
  maxCascadeResolution: number,
) {
  let count = 0
  const put = (
    kind: number,
    mapId: number,
    mip: number,
    x: number,
    y: number,
    z: number,
    radius: number,
  ) => {
    if (count >= DENSE_MAX_ENTRIES) return
    const at = count++ * DENSE_ENTRY_WORDS
    floats[at] = x
    floats[at + 1] = y
    floats[at + 2] = z
    floats[at + 3] = radius
    words[at + 4] = mapId
    words[at + 5] = mip
    words[at + 6] = kind
    words[at + 7] = 0
  }
  for (const sun of camera.perspective ? suns : [])
    putSunCascades(put, sun, camera, view, maxCascadeResolution)
  for (const light of locals) putLocalMaps(put, light)
  return count
}

/** The view's near plane in the shadow settings' centimetres, from the engine's in the world's units. */
export const nearInCentimetres = (near: number) => near * VSM_CM_PER_UNIT
