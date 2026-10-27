import { fieldLayout, vec4Array } from '../../gpu/core/fieldLayout.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { halton } from '../../../../math/src/sequence/halton.ts'

/**
 * THE FOG VOLUME'S GRID AND ITS FRAME: the cells the volume is cut into, how their depth is
 * spread, and the one uniform every pass of it reads (`writeFogVolumeFrame`, `frame.ts`).
 *
 * The grid is a set of cells over the screen and the distance — froxels. Across the image a cell is
 * `pixelSize` pixels square, the view cut into as many as it needs and the cells spread over it;
 * along the depth a cell's
 * slice is the logarithm of the view depth: `slice = log2(depth · B + O) · S`, with `S` the
 * distribution scale and `B`, `O` solved so that the first slice starts a little past the near plane
 * (`FIRST_SLICE_MARGIN`) and the last ends at the volume's far end. The view depth is the distance
 * along the camera's forward, not along the ray.
 */

/** How far past the near plane the first slice starts, metres: 9.5 centimetres of the engines that
 *  fixed the grid, so that no resolution is spent right in front of the camera. */
const FIRST_SLICE_MARGIN = 0.095
/** What is added to the depth buffer's reciprocal depth before it is inverted, per metre: 10⁻¹³ per
 *  centimetre, so that a pixel no surface drew (depth 0, reversed) converts to `1 / FOG_DEPTH_FUDGE`
 *  metres — 10¹¹ — and not to a division by zero. */
export const FOG_DEPTH_FUDGE = 1e-11
/** The error the history of a still view settles to, as a share of what a display tells apart: one
 *  step of eight bits. */
const SETTLED_ERROR = 1 / 256

/** How much more light the volume's glow gives where the fog is made to match the volume
 *  (`fogMatchesVolume`): the glow is then read in the unit of the fog's own colour, 10 000 times what
 *  it is otherwise, and follows the density of the medium (`fogMedium`, `./gridWgsl.ts`): the light
 *  per centimetre of the fog's colour times the density per centimetre. */
export const FOG_MATCH_GLOW_SCALE = 10000

/** The images a still view takes to make its volume whole: each blends the history in by the share
 *  `volumetricFogHistoryShare`, so the error of the first image is that share to the power of the
 *  images — whole once it is under `SETTLED_ERROR`; one image where there is no history to blend,
 *  or a share that never lets it go. */
export function historyHorizon(settings: {
  volumetricFogUsesHistory: boolean
  volumetricFogHistoryShare: number
}) {
  const share = Math.abs(settings.volumetricFogHistoryShare)
  if (!settings.volumetricFogUsesHistory || share === 0 || share >= 1) return 1
  const images = Math.log(SETTLED_ERROR) / Math.log(share)
  return Math.ceil(images)
}
/** The most cells a volume texture may have along an axis the grid is cut into: what the device
 *  grants a 3D texture (`maxTextureDimension3D`), 2048 by default. */
export const DEFAULT_MAX_VOLUME_DIMENSION = 2048

/** The grid over a view: cells across and down, slices along the depth, the side of a cell in
 *  pixels (raised where the view would need more cells than a texture holds). */
export interface FogGrid {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly pixelSize: number
}

/** The grid of a view of `width × height` pixels at the cell side `pixelSize` and `sizeZ` slices: as
 *  many cells as the view needs, the side raised only past `maxDimension`. */
export function cellGrid(
  width: number,
  height: number,
  pixelSize: number,
  sizeZ: number,
  maxDimension = DEFAULT_MAX_VOLUME_DIMENSION,
): FogGrid {
  let size = Math.max(1, Math.floor(pixelSize))
  let x = ceilDiv(width, size),
    y = ceilDiv(height, size)
  if (x > maxDimension || y > maxDimension) {
    size = Math.max(ceilDiv(width, maxDimension), ceilDiv(height, maxDimension))
    x = ceilDiv(width, size)
    y = ceilDiv(height, size)
  }
  return { x, y, z: Math.max(1, Math.floor(sizeZ)), pixelSize: size }
}

/** The numbers `B`, `O` and `S` the slice of a depth is `log2(depth · B + O) · S` by, for a volume
 *  from `near` to `far` metres over `sizeZ` slices spread by `scale`. */
export function sliceParams(near: number, far: number, scale: number, sizeZ: number) {
  const first = near + FIRST_SLICE_MARGIN
  const offset = (far - first * 2 ** (sizeZ / scale)) / (far - first)
  return { b: (1 - offset) / first, o: offset, s: scale }
}
/** The last texture coordinate along each axis a surface samples the volume at, so that no read
 *  leaves the cells the view covers: the rounded-up view less half a cell and a pixel, over the
 *  grid. */
export const volumeUvMax = (width: number, height: number, grid: FogGrid) => {
  const cover = (extent: number) => ceilDiv(extent, grid.pixelSize) * grid.pixelSize
  const inset = Math.floor(grid.pixelSize / 2) + 1
  return [
    (cover(width) - inset) / (grid.x * grid.pixelSize),
    (cover(height) - inset) / (grid.y * grid.pixelSize),
  ] as const
}
/** The format of the static term's volume: three single-precision floats a cell (and one unused), so that
 *  the mean of the samples' baked light reaches the scatter as the scatter would have summed it. */
export const FOG_STATIC_FORMAT = 'rgba32float' as const satisfies GPUTextureFormat
/** How many lighting samples a cell takes where the volume holds no history: 16 is the most. */
const MAX_REBUILD_SAMPLES = 16
/** The offsets within a cell the lighting samples are taken at, one per sample, as the images pass,
 *  written into `out` from its word `at`: the first this image's Halton point, the others the points
 *  of the images before — so that a cell whose history is missing averages what the history would
 *  have held. Without jitter every sample is the cell's centre. Nothing is allocated. */
export function writeSampleOffsets(
  out: Float32Array,
  at: number,
  frame: number,
  samples: number,
  jitter: boolean,
) {
  for (let s = 0; s < MAX_REBUILD_SAMPLES; s++) {
    const index = (frame - s) & 1023
    const from = at + s * 4
    const own = jitter && s < samples
    out[from] = own ? halton(index, 2) : 0.5
    out[from + 1] = own ? halton(index, 3) : 0.5
    out[from + 2] = own ? halton(index, 5) : 0.5
    out[from + 3] = 0
  }
}

/**
 * The frame the volume's passes read: the view's matrices — the volume's own unjittered ones, and the
 * matrix the depth buffer was drawn with —, the previous image's, the grid — the cells the view uses
 * — and the textures' — the cells they hold, more where the view is drawn smaller than the targets
 * were made for —, the numbers that map a depth to a slice and a device depth to a view depth, how
 * the history is read (`previous`, `history`: the previous image's view against this one's, and
 * where its cells end) and blended, the lights it takes, the tuning, the medium, the baked light it takes (`FogStaticLight`), the pre-exposure its light is
 * written multiplied by — with the ratio of it to the history's, its reciprocal and the exposure of the image before, which the lights' blend with its inverse is taken at —, the translucency volume
 * the cells read (its slices in `giGrid.z`, whether one is made in `giGrid.w`, the slices' law in `giZ`) and the
 * offsets of the samples. Every field is written by `writeFogVolumeFrame`; what a surface reads of it is the view
 * block (`viewSlots.ts`).
 */
export const FOG_VOLUME_FRAME = fieldLayout('FogVolumeFrame', [
  ['inverseViewProj', 'mat4x4f'],
  ['viewProj', 'mat4x4f'],
  ['depthViewProj', 'mat4x4f'],
  ['prevViewProj', 'mat4x4f'],
  ['eye', 'vec4f'],
  ['forward', 'vec4f'],
  ['view', 'vec4f'],
  ['grid', 'vec4f'],
  ['texture', 'vec4f'],
  ['sliceMap', 'vec4f'],
  ['depthMap', 'vec4f'],
  ['uv', 'vec4f'],
  ['previous', 'vec4f'],
  ['history', 'vec4f'],
  ['blend', 'vec4f'],
  ['lighting', 'vec4f'],
  ['tune', 'vec4f'],
  ['medium', 'vec4f'],
  ['particleColor', 'vec4f'],
  ['glow', 'vec4f'],
  ['staticLight', 'vec4f'],
  ['exposure', 'vec4f'],
  ['giGrid', 'vec4f'],
  ['giZ', 'vec4f'],
  ['offsets', vec4Array(MAX_REBUILD_SAMPLES)],
  ['frame', 'vec4u'],
] as const)
/** The frame's words. */
export const FOG_VOLUME_FRAME_WORDS = FOG_VOLUME_FRAME.words
/** The frame's WGSL structure and its members' places. */
export const FOG_VOLUME_FRAME_AT = FOG_VOLUME_FRAME.at
