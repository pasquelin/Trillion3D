import type { ResolvedVolumetricFog } from '../../../../sdk-core/src/scene/core/fogVolumetric.ts'
import type { VolumetricFogValues } from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import { putVec4 as put } from '../../gpu/core/fieldLayout.ts'
import { writeClipDepth } from '../../gpu/core/selectionProjection.ts'
import {
  FOG_VOLUME_FRAME,
  FOG_VOLUME_FRAME_AT,
  FOG_VOLUME_FRAME_WORDS,
  writeSampleOffsets,
  sliceParams,
  volumeUvMax,
  FOG_MATCH_GLOW_SCALE,
  type FogGrid,
} from './layout.ts'
import type { FogStaticLight } from './staticLight.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'

/** The bits of the frame's `medium.w`: which of the medium's switches are on. */
export const FOG_VOLUME_FLAG = {
  glow: 1,
  skipHidden: 2,
  usesHistory: 4,
  fogColors: 8,
  /** The objects of the volume material domain were voxelised into this image's volume. */
  voxels: 16,
  /** The local lights that shadow the fog read their shadow maps (`volumetricFogLocalShadows`). */
  localShadows: 32,
  /** The fog is made to match the volume (`fogMatchesVolume`): the glow follows the density. */
  matches: 64,
  /** A rectangle light that names a picture tints its light in the volume by it (`volumetricFogRectLightTexture`). */
  rectTexture: 128,
} as const

/** What one image tells the volume about its camera: the matrices as column-major arrays — the
 *  unjittered projection, view-projection and its inverse, the one the depth buffer was drawn with
 *  —, the eye and the unit forward, the pixels of the view. */
interface FogVolumeCamera {
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
  /** Whether the projection is a perspective, or an orthographic one: its depth buffer is then linear in
   *  the view depth, and its rays parallel. */
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
  /** The translucency volume this image made, whose light the cells take in the place of the sky light's: its cells and the
   *  slices' law as the surfaces read them (`published` of `translucencyGi/gpu.ts`); none where no volume is made. */
  translucencyGi?: { readonly grid: ArrayLike<number>; readonly z: ArrayLike<number> }
  /** The rank of the directional light that lights the volume — the one the forward readers take
   *  (`SceneLightStore.forwardDirectionalSlot`): of the highest priority, then the brightest —, −1
   *  for none. */
  sunRank: number
  /** The columns and rows of the light grid the lights of a cell are read from. */
  lightCells: readonly [number, number]
  /** The image's number, which moves the jitter. */
  frameIndex: number
  /** The pre-exposure the volume's light is written multiplied by (`../../post/exposure/pre.ts`). */
  preExposure: number
  /** The exposure of the image before (`../../post/exposure/pre.ts`), which the lights' blend with its inverse is taken at. */
  exposure: number
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
  put(out, at.depthMap, depthMap[0], depthMap[1], camera.perspective ? 0 : 1)
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

/** How far the cells of a view of `size` pixels overhang it, along an axis: the view over what
 *  `cells` cells of `pixel` pixels cover. */
const overhang = (size: number, cells: number, pixel: number) => size / (cells * pixel)

/** The history's fields. The cells of an image are spread over its view, `overhang` of them past its
 *  edge, and the textures are made for the targets, so that a view drawn smaller than they were —
 *  or than the image before was — reads the volume before where its cells were: the ratio of the
 *  two overhangs (`previous.xy`), the previous image's cells over the textures' (`history.xy`, with
 *  the ratio), where its cells end (`history.zw`) and where a read may reach (`previous.zw`). The
 *  weight the history is blended in with: none without one. */
function writeHistory(out: Float32Array, image: FogVolumeImage) {
  const at = FOG_VOLUME_FRAME_AT
  const { camera, grid, resource, settings, previous } = image
  const before = previous ?? camera
  const { pixelSize: pixel } = resource
  const cells = [ceilDiv(before.width, pixel), ceilDiv(before.height, pixel)]
  const ratio = [
    overhang(before.width, cells[0], pixel) / overhang(camera.width, grid.x, pixel),
    overhang(before.height, cells[1], pixel) / overhang(camera.height, grid.y, pixel),
  ]
  const [prevU, prevV] = volumeUvMax(before.width, before.height, resource)
  const covered = [cells[0] / resource.x, cells[1] / resource.y]
  put(out, at.previous, ratio[0], ratio[1], prevU, prevV)
  put(out, at.history, ratio[0] * covered[0], ratio[1] * covered[1], covered[0], covered[1])
  const usable = !!previous && settings.volumetricFogUsesHistory
  put(
    out,
    at.blend,
    usable ? settings.volumetricFogHistoryShare : 0,
    image.rebuildSamples,
    settings.volumetricFogEdgeFade,
  )
  // The history's light, written multiplied by its own pre-exposure, is brought to this image's.
  const now = image.preExposure
  // `w`: the exposure of the image before, which a light's blend with its inverse is taken at (`lightStrength`).
  put(out, at.exposure, now, previous ? now / previous.preExposure : 1, 1 / now, image.exposure)
}

/** The medium's fields, the tuning, the lights it takes and the offsets of the samples. */
function writeMedium(out: Float32Array, image: FogVolumeImage) {
  const at = FOG_VOLUME_FRAME_AT
  const { medium, settings } = image
  put(out, at.lighting, image.sunRank, image.lightCells[0], image.lightCells[1], 0)
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
    (image.voxels ? FOG_VOLUME_FLAG.voxels : 0) |
    (settings.volumetricFogLocalShadows ? FOG_VOLUME_FLAG.localShadows : 0) |
    (settings.volumetricFogRectLightTexture ? FOG_VOLUME_FLAG.rectTexture : 0) |
    (settings.fogMatchesVolume ? FOG_VOLUME_FLAG.matches : 0)
  const { anisotropy: g, densityScale, fadeInRate } = medium
  put(out, at.medium, g, densityScale, fadeInRate, flags)
  put(
    out,
    at.particleColor,
    medium.particleColor[0],
    medium.particleColor[1],
    medium.particleColor[2],
  )
  const glowScale = settings.fogMatchesVolume ? FOG_MATCH_GLOW_SCALE : 1
  put(
    out,
    at.glow,
    medium.glow[0] * glowScale,
    medium.glow[1] * glowScale,
    medium.glow[2] * glowScale,
  )
  const { staticLight, translucencyGi } = image
  if (translucencyGi) {
    out.set(translucencyGi.grid, at.giGrid)
    out.set(translucencyGi.z, at.giZ)
  }
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

/** The WGSL declaration of the frame's structure. */
export const FOG_VOLUME_FRAME_WGSL = FOG_VOLUME_FRAME.wgsl
