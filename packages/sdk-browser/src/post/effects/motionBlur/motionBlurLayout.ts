import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { listBytes } from '../../../gpu/dispatch/list.ts'
import { textureBytesOf } from '../../../gpu/core/textureBytes.ts'
import { HDR_FORMAT } from '../../../scene/targetFormats.ts'

/**
 * What the motion blur's passes agree on, with no shader text (the byte rules read it without the
 * renderer's, as `../outline/outlineTarget.ts` is read): the sizes of its tiles, the formats of
 * what it keeps, the tile classes its filter passes are made for, and the uniform every pass reads.
 */

/** Texels of the motion, flattened to one range (the largest and the smallest) in each tile of
 *  the image the temporal pass measured it on, across and down. */
export const FLATTEN_TILE = 16
/** The reach of a tile's largest motion, in tiles each way, that reading the neighbours sees; a
 *  streak of more tiles is spread by drawing it. */
export const GATHER_REACH = 3

/** Pixels of the blurred image, across and down, that one workgroup of the filter's covers, and
 *  that one range of the classifying pass covers. */
export const FILTER_TILE = 16

/** The flattened motion of each texel, one word of 4 bytes: its length in pixels and its angle
 *  (0 to 1 round the circle) as unsigned floats of 11 bits (5 of exponent, 6 of mantissa), its
 *  scene depth, in centimetres, as one of 10 (`FLAT_PACK_WGSL`): the precision of a 3-channel
 *  11-11-10 float, what an image of a 3840 × 2160 render keeps in 33 MB. */
export const FLAT_FORMAT: GPUTextureFormat = 'r32uint'
/** Centimetres in a unit of the scene (a metre), the unit the flattened depth is kept and weighed
 *  in: the soft extent of a depth test is one of them. */
export const CENTIMETRES_PER_UNIT = 100
/** The range of each tile: its smallest motion and its largest, in pixels; with two directions
 *  beside it, in an image of the same format, the second largest in its first two channels. */
export const TILE_FORMAT: GPUTextureFormat = 'rgba16float'
/** The spread tiles are drawn with, ordered by the length of their motion. */
export const TILE_DEPTH_FORMAT: GPUTextureFormat = 'depth32float'
/** The blurred image: the format of the effect chain's images. */
export const OUTPUT_FORMAT = HDR_FORMAT

/** The channels a draw of the spread writes (`GPUColorWrite`): all four, or the blue and the alpha
 *  alone, the largest motion's. */
export const WRITE_ALL = 0xf
export const WRITE_LARGEST = 0xc

/** The classes a filter tile is put in, by the motion of the tiles around it, and the pass each is
 *  filtered by: every pixel gathered along one motion, or weighed by the depth and motion of what
 *  it crosses, each at half the resolution of the image or at its own. */
export const TILE_CLASSES = ['gatherHalf', 'gatherFull', 'weighHalf', 'weighFull'] as const
/** The class a tile where two motions cross is put in, with two directions: its pixels gathered
 *  along both, at the resolution of the image. */
export const TWO_MOTION_CLASS = 'weighTwo'
/** The classes with two directions: those of one, and the class of two motions. */
export const TILE_CLASSES_TWO = [...TILE_CLASSES, TWO_MOTION_CLASS] as const
/** A class of filter tile. */
export type TileClass = (typeof TILE_CLASSES_TWO)[number]
/** The classes the blur makes lists of, for `directions` of 1 or 2. */
export const tileClasses = (directions: number): readonly TileClass[] =>
  directions > 1 ? TILE_CLASSES_TWO : TILE_CLASSES
/** Whether a class gathers its pixels in 2 × 2 quads, at half the resolution of the image. */
export const isHalfClass = (kind: TileClass) => kind === 'gatherHalf' || kind === 'weighHalf'

/** The uniform every pass reads (`MOTION_BLUR_PARAMS_WGSL`). */
export const MOTION_BLUR_PARAMS = fieldLayout('MotionBlurParams', [
  // The colour image: width, height, their inverses.
  ['color', 'vec4f'],
  // The motion scale to pixels of the colour image (x, y), the longest streak, in pixels, and the
  // tile units a pixel of the motion's grid is.
  ['scale', 'vec4f'],
  // The tiles of motion: across and down; the filter tiles: across and down.
  ['tiles', 'vec4u'],
  // The samples a pixel takes at most, whether a tile past that many pixels is gathered at half
  // the resolution, whether the samples may read the half-size image, whether the camera's motion
  // is taken out (1) or left in (0): switches as 0 or 1.
  ['knobs', 'vec4f'],
  // The grid the motion was measured on, this image's render grid: width, height.
  ['grid', 'vec2f'],
] as const)
/** Bytes of the uniform. */
export const MOTION_BLUR_PARAMS_BYTES = MOTION_BLUR_PARAMS.words * 4

/** The tiles of an image `size` pixels across or down: `FLATTEN_TILE` pixels each. */
export const flattenTiles = (size: number) => ceilDiv(size, FLATTEN_TILE)
/** The filter tiles of an image `size` pixels across or down: `FILTER_TILE` pixels each. */
export const filterTiles = (size: number) => ceilDiv(size, FILTER_TILE)

/** Entries of a class's list of filter tiles, one a tile (`gpu/dispatch/list.ts`): as many as an
 *  image holds, whatever its class. */
export const classEntries = (width: number, height: number) =>
  filterTiles(width) * filterTiles(height)

/** Bytes of what a `width × height` image holds while it is blurred, the pass's textures and
 *  buffers at the images' own size — the motion's grid never larger than the display's —: the
 *  blurred image, the flattened motion, the tiles' two ranges and the drawn spread's depth, the
 *  lists, the uniform. A second pass of the blur adds an image (`separable`), counted where it
 *  is made. */
export function motionBlurBytes(width: number, height: number) {
  const tile = [flattenTiles(width), flattenTiles(height)] as const
  const bytes = (size: readonly [number, number], format: GPUTextureFormat) =>
    textureBytesOf({ size, format }) ?? 0
  return (
    bytes([width, height], OUTPUT_FORMAT) +
    bytes([width, height], FLAT_FORMAT) +
    2 * bytes(tile, TILE_FORMAT) +
    bytes(tile, TILE_DEPTH_FORMAT) +
    TILE_CLASSES.length * listBytes(classEntries(width, height), 1) +
    MOTION_BLUR_PARAMS_BYTES
  )
}
