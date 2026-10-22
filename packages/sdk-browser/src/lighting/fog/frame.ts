import type { ResolvedVolumetricFog } from '../../../../sdk-core/src/scene/core/fogVolumetric.ts'
import {
  VOLUMETRIC_FOG_FILTERS,
  type VolumetricFogValues,
} from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import { putVec4 as put } from '../../gpu/core/fieldLayout.ts'
import { writeClipDepth } from '../../gpu/core/selectionProjection.ts'
import {
  FOG_VOLUME_FRAME,
  FOG_VOLUME_FRAME_AT,
  FOG_VOLUME_FRAME_WORDS,
  writeSampleOffsets,
  sliceParams,
  volumeUvMax,
  type FogGrid,
} from './layout.ts'
import type { FogStaticLight } from './staticLight.ts'
import { FOG_VIEW_FLOATS, FOG_VIEW_SLOT } from './viewSlots.ts'

/** The bits of the frame's `medium.w`: which of the medium's switches are on. */
export const FOG_VOLUME_FLAG = {
  glow: 1,
  skipHidden: 2,
  usesHistory: 4,
  fogColors: 8,
  /** The objects of the volume material domain were voxelised into this image's volume. */
  voxels: 16,
} as const

/** The filtering of the volume's read, by the number the shader branches on: its place in the list. */
const filterCode = (settings: VolumetricFogValues) =>
  VOLUMETRIC_FOG_FILTERS.indexOf(settings.volumetricFogReadFilter)

/** What one image tells the volume about its camera: the matrices as column-major arrays — the
 *  unjittered projection, view-projection and its inverse, the one the depth buffer was drawn with
 *  —, the eye and the unit forward, the pixels of the view. */
export interface FogVolumeCamera {
  eye: ArrayLike<number>
  forward: ArrayLike<number>
  /** The engine's projection (`EngineCamera.projection`): its clip depth maps the depth buffer's
   *  values to view depths. */
  projection: ArrayLike<number>
  viewProj: ArrayLike<number>
  inverseViewProj: ArrayLike<number>
  depthViewProj: ArrayLike<number>
  /** The camera's world matrix: its first column is the right and its second the up of the view. */
  world: ArrayLike<number>
  /** The distance of the near plane, metres. */
  near: number
  width: number
  height: number
  /** Whether the projection is a perspective: an orthographic view has no volume. */
  perspective: boolean
}

/** What the volume kept of the image before: its view-projection and the size it was drawn at, or
 *  nothing where there is no history (a first image, a camera cut, a change of what is held hidden or
 *  of the textures it was written to). */
export interface FogVolumePrevious {
  viewProj: ArrayLike<number>
  width: number
  height: number
  /** The pre-exposure the volume's light was written multiplied by. */
  preExposure: number
}

/** What the image gives the volume. */
export interface FogVolumeImage {
  camera: FogVolumeCamera
  /** The previous image's, absent where its history cannot be read. */
  previous?: FogVolumePrevious
  /** The cells the view uses: its size over the cell's side. */
  grid: FogGrid
  /** The cells the textures hold, made for the targets' whole size, so that a view drawn smaller —
   *  a dynamic resolution — keeps its textures and its history: never fewer than `grid`'s, the same
   *  side in pixels. */
  resource: FogGrid
  /** The fog's medium and the settings of the run. */
  medium: ResolvedVolumetricFog
  settings: VolumetricFogValues
  /** The samples a cell takes where it has no history (`VolumetricFogKnobs.rebuildSamples`). */
  rebuildSamples: number
  /** Whether a cell behind the surfaces of its pixels is held hidden: the setting, and the depth
   *  pyramid its furthest depth is read from. */
  skipHidden: boolean
  /** Whether the objects of the volume material domain were voxelised into this image's volume. */
  voxels: boolean
  /** What the volume takes of the baked light (`FogStaticLight`), and whether the static term's pass
   *  wrote its volume this image (it needs the lightmap and a term to add): the sky light is left to
   *  that pass only then. */
  staticLight: FogStaticLight
  staticBuilt: boolean
  /** The rank of the directional light that lights the volume — the light store's held sun, the
   *  one the analytic fog's lobe follows (`SceneLightStore.fogSunSlot`) —, −1 for none. */
  sunRank: number
  /** The columns and rows of the light grid the lights of a cell are read from. */
  lightCells: readonly [number, number]
  /** The image's number, which moves the jitter. */
  frameIndex: number
  /** The pre-exposure the volume's light is written multiplied by (`../../post/exposure/pre.ts`). */
  preExposure: number
}

/** The depth buffer's map to a view depth, `a` and `b`, rewritten each image. */
const depthMap: [number, number] = [0, 0]

/** The bits of an unsigned integer as the float that holds them, for the frame's integer word. */
const bits = new Uint32Array(1)
const asFloat = new Float32Array(bits.buffer)

/** The grid's fields: its cells, the depth numbers, the read's texture coordinates. */
function writeGrid(out: Float32Array, image: FogVolumeImage) {
  const at = FOG_VOLUME_FRAME_AT
  const { camera, grid, resource, medium, settings } = image
  const pixel = grid.pixelSize
  // The first slice starts where the volume does, or at the near plane if that is farther.
  const zs = sliceParams(
    Math.max(camera.near, medium.startAt),
    medium.farEnd,
    settings.volumetricFogSliceSpread,
    grid.z,
  )
  // The depth buffer's value `z` is `a + b / depth`: the clip depth of the projection.
  writeClipDepth(depthMap, camera.projection)
  put(out, at.grid, grid.x, grid.y, grid.z, pixel)
  put(out, at.texture, resource.x, resource.y, resource.z, pixel)
  put(out, at.sliceMap, zs.b, zs.o, zs.s, 1 / grid.z)
  put(out, at.depthMap, depthMap[0], depthMap[1])
  const [maxU, maxV] = volumeUvMax(camera.width, camera.height, resource)
  put(
    out,
    at.uv,
    camera.width / (resource.x * pixel),
    camera.height / (resource.y * pixel),
    maxU,
    maxV,
  )
}

/** The history's fields: the previous image's constants, and the weight it is blended in with. */
function writeHistory(out: Float32Array, image: FogVolumeImage) {
  const at = FOG_VOLUME_FRAME_AT
  const { camera, resource, settings, previous } = image
  const before = previous ?? camera
  const usable = !!previous && settings.volumetricFogUsesHistory
  const { pixelSize } = resource
  const [prevU, prevV] = volumeUvMax(before.width, before.height, resource)
  put(
    out,
    at.previous,
    before.width / (resource.x * pixelSize),
    before.height / (resource.y * pixelSize),
    prevU,
    prevV,
  )
  const weight = usable ? settings.volumetricFogHistoryShare : 0
  put(out, at.blend, weight, image.rebuildSamples)
  // The history's light, written multiplied by its own pre-exposure, is brought to this image's.
  const now = image.preExposure
  put(out, at.exposure, now, previous ? now / previous.preExposure : 1, 1 / now)
}

/** The medium's fields, the tuning, the lights it takes and the offsets of the samples. */
function writeMedium(out: Float32Array, image: FogVolumeImage) {
  const at = FOG_VOLUME_FRAME_AT
  const { medium, settings } = image
  put(out, at.lighting, image.sunRank, image.lightCells[0], image.lightCells[1])
  const jitter = settings.volumetricFogMovesSamples
  put(
    out,
    at.tune,
    settings.volumetricFogSurfaceLift,
    settings.volumetricFogLiftRange,
    jitter ? settings.volumetricFogSampleScatter : 0,
    settings.volumetricFogLampSoftening,
  )
  const flags =
    (settings.volumetricFogGlow ? FOG_VOLUME_FLAG.glow : 0) |
    (image.skipHidden ? FOG_VOLUME_FLAG.skipHidden : 0) |
    (settings.volumetricFogUsesHistory ? FOG_VOLUME_FLAG.usesHistory : 0) |
    (medium.useFogColors ? FOG_VOLUME_FLAG.fogColors : 0) |
    (image.voxels ? FOG_VOLUME_FLAG.voxels : 0)
  const { anisotropy: g, densityScale, fadeInRate } = medium
  put(out, at.medium, g, densityScale, fadeInRate, flags)
  put(
    out,
    at.particleColor,
    medium.particleColor[0],
    medium.particleColor[1],
    medium.particleColor[2],
  )
  put(out, at.glow, medium.glow[0], medium.glow[1], medium.glow[2])
  const { staticLight } = image
  put(
    out,
    at.staticLight,
    staticLight.intensity,
    staticLight.skyShadowing && image.staticBuilt ? 1 : 0,
    staticLight.skyDiffuse ? 1 : 0,
    image.staticBuilt ? 1 : 0,
  )
  // The cells' samples move from image to image only where the history averages them: the jitter
  // of the offsets needs the reprojection, the random jitter of each sample (`tune.z`) does not.
  const moving = jitter && settings.volumetricFogUsesHistory
  writeSampleOffsets(out, at.offsets, image.frameIndex, image.rebuildSamples, moving)
}

/**
 * Writes the image into the frame (`FOG_VOLUME_FRAME`, `FOG_VOLUME_FRAME_WORDS` words): the matrices,
 * the eye and its forward, the grid and the depth numbers, how the history is blended — the weight
 * is zero where there is no history or reprojection is off —, the samples and their jitter, the
 * tuning, the medium. Nothing is allocated.
 */
export function writeFogVolumeFrame(out: Float32Array, image: FogVolumeImage) {
  const at = FOG_VOLUME_FRAME_AT
  const { camera, previous } = image
  out.fill(0, 0, FOG_VOLUME_FRAME_WORDS)
  out.set(camera.inverseViewProj, at.inverseViewProj)
  out.set(camera.viewProj, at.viewProj)
  out.set(camera.depthViewProj, at.depthViewProj)
  out.set(previous?.viewProj ?? camera.viewProj, at.prevViewProj)
  put(out, at.eye, camera.eye[0], camera.eye[1], camera.eye[2])
  put(out, at.forward, camera.forward[0], camera.forward[1], camera.forward[2])
  put(out, at.view, camera.width, camera.height, 1 / camera.width, 1 / camera.height)
  writeGrid(out, image)
  writeHistory(out, image)
  writeMedium(out, image)
  bits[0] = image.frameIndex & 7
  out[at.frame] = asFloat[0]
  return out
}

/** A frame's worth of words, to write into (`writeFogVolumeFrame`). */
export const newFogVolumeFrame = () => new Float32Array(FOG_VOLUME_FRAME_WORDS)
/** The WGSL declaration of the frame's structure. */
export const FOG_VOLUME_FRAME_WGSL = FOG_VOLUME_FRAME.wgsl

/** `count` words of `frame` from `from` into the slot `slot` of the view block `out`. */
function copyWords(
  out: Float32Array,
  slot: number,
  frame: Float32Array,
  from: number,
  count: number,
) {
  for (let i = 0; i < count; i++) out[slot * 4 + i] = frame[from + i]
}

/**
 * Writes the read side's view block (`FOG_VIEW_SLOT`, `FOG_VIEW_FLOATS` floats) from the frame `frame`
 * the volume was built with, `settings` naming the filter a surface reads it through: the
 * view-projection, the eye with 1 in its last lane, the forward, the depth's numbers, the span of
 * the cells and their count. Where the volume was not built for the image (`frame` none), all
 * zero: a surface reads no volume (`fogVolumeBuilt`). Nothing is allocated.
 */
export function writeFogViewBlock(
  out: Float32Array,
  frame: Float32Array | undefined,
  settings: VolumetricFogValues,
) {
  const at = FOG_VOLUME_FRAME_AT
  out.fill(0, 0, FOG_VIEW_FLOATS)
  if (!frame) return out
  copyWords(out, FOG_VIEW_SLOT.projection, frame, at.viewProj, 16)
  copyWords(out, FOG_VIEW_SLOT.eye, frame, at.eye, 3)
  out[FOG_VIEW_SLOT.eye * 4 + 3] = 1
  copyWords(out, FOG_VIEW_SLOT.forward, frame, at.forward, 3)
  out[FOG_VIEW_SLOT.forward * 4 + 3] = filterCode(settings)
  copyWords(out, FOG_VIEW_SLOT.sliceMap, frame, at.sliceMap, 4)
  copyWords(out, FOG_VIEW_SLOT.uv, frame, at.uv, 4)
  copyWords(out, FOG_VIEW_SLOT.grid, frame, at.texture, 4)
  copyWords(out, FOG_VIEW_SLOT.exposure, frame, at.exposure, 4)
  return out
}
