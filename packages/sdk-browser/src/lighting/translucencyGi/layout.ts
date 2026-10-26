import type { TranslucencyGiValues } from '../../../../sdk-core/src/contracts/translucencyGiOptions.ts'
import { ceilDiv, floorLog2 } from '../../../../math/src/scalar/integers.ts'
import { halton } from '../../../../math/src/sequence/halton.ts'
import { fieldLayout } from '../../gpu/core/fieldLayout.ts'

/**
 * THE TRANSLUCENCY GLOBAL ILLUMINATION VOLUME'S SHAPES: a grid fitted to the view (`TranslucencyGiGrid`) — a cell of `translucencyGiGridPixelSize`
 * pixels a side across the image, its depth slices spaced on a logarithm of the distance from the camera —, in which each image the cells'
 * light is traced (`traceWgsl.ts`), filtered along the three axes (`filterWgsl.ts`), projected on two-band harmonics and blended with the
 * image before's (`integrateWgsl.ts`), and which the see-through surfaces read with one filtered fetch (`readWgsl.ts`).
 *
 * THE TEXTURES. The trace holds `tracing × tracing` cones a cell: a texture of `grid.x · tracing` by `grid.y · tracing` by `grid.z`
 * texels, the cone `(i, j)` of cell `(x, y, z)` at `(x · tracing + i, y · tracing + j, z)`. The volume the surfaces read is one
 * texture of the grid's size by twice its depth: the ambient light (the harmonics' constant band, one colour) in the first
 * half of the slices, the directional light (the three linear bands, the colours' luminance) in the second. Two such textures take turns:
 * the one written is the history of the next image.
 *
 * THE FRAME. One uniform every pass reads (`TRANSLUCENCY_GI_FRAME`): `grid` the cells along the axes and the shift of the cell's side;
 * `extent` the view's size and its reciprocal; `zParams` the slices' logarithm (scale, offset, slices a doubling) and the camera's near
 * plane; `jitter` the point of a cell the light is traced from (cells) and the turn of the cone directions (negative: none);
 * `trace` the cones a side, the most a cone brings back, the pre-exposure and its reciprocal;
 * `depth` how far in front of the depth a cell's point is held, the nearest it may lie behind it to be moved, the level of the depth
 * pyramid whose texel covers a cell's footprint (`translucencyGiFootprintLevel`), whether the march of the distance field is on; `temporal`
 * the history's weight, whether the history holds, the image's rank, the cascades the radiance cache is read coarser by; `spatial` the
 * cells either side of the filter, the Gaussian's two factors, whether the radiance cache is read; `previous` the image before's
 * view-projection set at its eye (`viewProjectionRelative`) and `eyeMoved` the eye of this image minus that one's (taken in double precision, so that a
 * place found relative to this eye is carried to the image before's without a large term), `inverse` this image's inverse (of the view-projection
 * set at the eye), all of the camera without the anti-aliasing jitter (the cells' places and the history's reprojection do not shake with it).
 */

/** The format of the cones' light and of the volume: half floats. */
export const TRANSLUCENCY_GI_FORMAT: GPUTextureFormat = 'rgba16float'

/** The side of a workgroup of the kernels over the cones and the cells, texels. */
export const TRANSLUCENCY_GI_GROUP = 8

/**
 * The most cells a side that a block of `TRANSLUCENCY_GI_GROUP` cone texels a side, from a multiple of it, touches where a cell holds two cones
 * or more a side (`giSlotSide`): the trace's workgroup keeps what the cells of its block share in as many slots.
 */
export const TRANSLUCENCY_GI_SLOT_SIDE = 4

/** The cells a side that a block of `group` cone texels a side, from a multiple of `group`, touches for `tracing` cones a cell side: the most over
 *  the blocks (the block's offset in its first cell takes every value the multiples of `group` give modulo `tracing`). */
export function giSlotSide(tracing: number, group: number = TRANSLUCENCY_GI_GROUP) {
  let most = 1
  for (let block = 0; block < tracing; block++)
    most = Math.max(most, Math.floor((((block * group) % tracing) + group - 1) / tracing) + 1)
  return most
}

/** The frame's fields (`TranslucencyGiFrame`), in order. */
export const TRANSLUCENCY_GI_FRAME = fieldLayout('TranslucencyGiFrame', [
  ['grid', 'vec4u'],
  ['extent', 'vec4f'],
  ['zParams', 'vec4f'],
  ['jitter', 'vec4f'],
  ['trace', 'vec4f'],
  ['depth', 'vec4f'],
  ['temporal', 'vec4f'],
  ['spatial', 'vec4f'],
  ['previous', 'mat4x4f'],
  ['eyeMoved', 'vec4f'],
  ['inverse', 'mat4x4f'],
] as const)

/** The cells of the grid and the slices' law, for a view of a size and a camera's near plane (`translucencyGiGrid`). */
export interface TranslucencyGiGrid {
  readonly x: number
  readonly y: number
  readonly z: number
  /** The base-two logarithm of the cell's side. */
  readonly shift: number
  /** The slices' law: scale and offset of the logarithm, slices a doubling. */
  readonly logZScale: number
  readonly logZOffset: number
  readonly zScale: number
}

/** A grid whose fields can be written, the one `translucencyGiGrid` fills in place. */
export type TranslucencyGiGridInto = { -readonly [K in keyof TranslucencyGiGrid]: number }

/**
 * The grid for a view of `width × height` pixels: `ceil(side / cell)` cells along each axis and, along the depth, the slices of the
 * logarithm of the distance (`slice = log2(depth · logZScale + logZOffset) · zScale`) from the near plane to the end distance, one
 * more than their number of whole doublings, at least one. Written into `into` where one is given (an image allocates nothing).
 */
export function translucencyGiGrid(
  values: TranslucencyGiValues,
  width: number,
  height: number,
  near: number,
  into: TranslucencyGiGridInto = {} as TranslucencyGiGridInto,
): TranslucencyGiGrid {
  const cell = Math.max(1, Math.floor(values.translucencyGiGridPixelSize))
  const logZScale = values.translucencyGiGridDistributionLogZScale
  const zScale = values.translucencyGiGridDistributionZScale
  const span = Math.max(values.translucencyGiEndDistance - near, 0) * logZScale
  const slices = span > 0 ? Math.trunc(Math.log2(span) * zScale) + 1 : 1
  into.x = ceilDiv(width, cell)
  into.y = ceilDiv(height, cell)
  into.z = Math.max(slices, 1)
  into.shift = floorLog2(cell)
  into.logZScale = logZScale
  into.logZOffset = values.translucencyGiGridDistributionLogZOffset
  into.zScale = zScale
  return into
}

/**
 * The level of the depth pyramid (level 0 the image's pixels, a texel of level `n` `2^n` pixels a side) whose texel covers the footprint
 * of a cell the visibility test reads: the one a mip of the reference's farthest depth pyramid — whose first level is half the image's
 * size, so that its level `n` is ours `n + 1` — reads one level above the cell's (`max(shift − 1, 0) + 1`), that is `max(shift − 1, 0) + 2`
 * here: a texel two cells across (four where a cell is a pixel).
 */
export const translucencyGiFootprintLevel = (shift: number) => Math.max(shift - 1, 0) + 2

/** The point of a cell an image traces its light from, in cells (`xyz`), and the turn of its cone directions (`w`, negative for none): the
 *  cell's centre without the jitter, else a point of the Halton sequence of the image's rank. */
export function translucencyGiJitter(
  values: TranslucencyGiValues,
  frame: number,
  out: Float32Array,
  at: number,
) {
  const on = values.translucencyGiTemporalJitter
  const index = frame & 1023
  out[at] = on ? halton(index, 2) : 0.5
  out[at + 1] = on ? halton(index, 3) : 0.5
  out[at + 2] = on ? halton(index, 5) : 0.5
  out[at + 3] = on ? frame % Math.max(1, values.translucencyGiTemporalMaxRayDirections) : -1
}

/** The size of the texture of the cones' light for a grid and `tracing` cones a cell side. */
export const traceExtent = (
  grid: TranslucencyGiGrid,
  tracing: number,
): [number, number, number] => [grid.x * tracing, grid.y * tracing, grid.z]

/** The size of the volume's texture: the grid's, twice as deep (the ambient light, then the directional). */
export const volumeExtent = (grid: TranslucencyGiGrid): [number, number, number] => [
  grid.x,
  grid.y,
  grid.z * 2,
]
