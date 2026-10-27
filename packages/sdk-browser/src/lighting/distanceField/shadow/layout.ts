import { alignUp, ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { arrayOf, fieldLayout, vec4Array } from '../../../gpu/core/fieldLayout.ts'
import { subsurfaceDensityOf } from '../../subsurfaceDensity.ts'

/**
 * THE SUN'S DISTANCE-FIELD SHADOW, laid out once for the host that fills it and the programs that
 * read it (`params.ts`, `*Wgsl.ts`). The cascade past a sun's near shadow levels is traced against
 * the meshes' distance fields (`../meshFieldWgsl.ts`), at half the resolution of the view, and
 * upsampled into a mask the lit image multiplies the sun's shadow by (`finalWgsl.ts`). Lengths
 * are centimetres, the unit of the fields; positions are the eye's, so that a float holds them
 * whatever the distance from the origin.
 *
 * `DfshParams`, one a light (the passes of a light read it at their own offset of one buffer):
 *  - `unproject` takes a device position and depth to the position from the eye, `toShadow` a
 *    position from the eye to the cascade's shadow space — the light's right and up over the
 *    cascade sphere's radius, then the distance toward the light from that sphere's far side over
 *    the same radius —, `planes` the cascade's culling hull, `count` of them in `counts.x`;
 *  - `eyeHigh` and `eyeLow` the eye as a pair of floats (xyz); `light` the unit direction toward
 *    the light and the tangent of its angle, `trace` the farthest a ray goes, the share of the depth
 *    its start is offset by, the steps of a ray and the density of the light a thin transmitting
 *    surface lets through (0 where the quality has none);
 *  - `range` the depths the cascade is traced between and the factor on a two-sided mesh's bias,
 *    `expand` the world radius each mesh's box is grown by where it is listed (one tile's half
 *    diagonal) and the shadow-space length of the widest cone radius;
 *  - `view` the view's size in pixels, the downsample of the trace and the layer it writes;
 *    `tiles` the tile grid's side, the entries its lists hold and the meshes of the scene;
 *    `counts` the planes, the vertex count of the cube a mesh is drawn as, the flags (`DFSH_FLAG`);
 *  - `depth` how a device depth turns into a distance (as `ao/layout.ts`'s).
 */
export const DFSH_PARAMS = fieldLayout('DfshParams', [
  ['unproject', 'mat4x4f'],
  ['toShadow', 'mat4x4f'],
  ['planes', vec4Array(12)],
  ['eyeHigh', 'vec4f'],
  ['eyeLow', 'vec4f'],
  ['light', 'vec4f'],
  ['trace', 'vec4f'],
  ['range', 'vec4f'],
  ['expand', 'vec4f'],
  ['view', 'vec4u'],
  ['tiles', 'vec4u'],
  ['counts', 'vec4u'],
  ['depth', 'vec4f'],
] as const)

/** Bytes of one light's uniform, and the stride the frame's lights' are laid at (a dynamic offset
 *  is a multiple of 256). */
export const DFSH_PARAMS_BYTES = DFSH_PARAMS.words * 4
export const DFSH_PARAMS_STRIDE = alignUp(DFSH_PARAMS_BYTES, 256)

/** The bits of `counts.w`. */
export const DFSH_FLAG = {
  /** The sun's far-shadow test reaches every mesh (`farShadowCullsAllMeshes`), not those alone that
   *  say it does. */
  farMeshes: 1,
} as const

/**
 * `DfshFinal`, what the upsample reads of the frame's lights: for each of the four lanes of the
 * mask, whether a cascade is traced for it and in which layer of the half-resolution result
 * (`lane`), the depths it is traced between, where it fades out and the inverse length of that
 * fade (`range`), where it fades in and the inverse length of that, with the share of the shadow
 * it keeps (`fade`); then the view's size, the trace's downsample and the lanes in use (`view`),
 * the buffers' width, the row stride of the mask (`extent`), and how a device depth turns into a
 * distance (`depth`).
 */
export const DFSH_LIGHT = fieldLayout('DfshLight', [
  ['range', 'vec4f'],
  ['fade', 'vec4f'],
  ['lane', 'vec4u'],
] as const)
export const DFSH_FINAL = fieldLayout(
  'DfshFinal',
  [
    ['view', 'vec4u'],
    ['extent', 'vec4u'],
    ['depth', 'vec4f'],
    ['lights', arrayOf(DFSH_LIGHT, 4)],
  ] as const,
  '',
)
export const DFSH_FINAL_BYTES = DFSH_FINAL.words * 4

/** The lanes of the mask, one byte each: the suns a frame traces a cascade for, the first four. */
export const DFSH_MAX_LIGHTS = 4
/** The planes of a cascade's culling hull. */
export const DFSH_PLANES = 12
/** The side of a group of the trace and of the upsample, in pixels. */
export const DFSH_TILE = 8
/** The threads of a group of the meshes' culling. */
export const DFSH_CULL_GROUP = 64
/** The side of a group of the tiles' start offsets, in tiles. */
export const DFSH_OFFSET_GROUP = 8
/** The most tiles along a side of the grid the meshes are listed in, and what its side is a multiple
 *  of. */
const DFSH_MAX_TILES = 256
const DFSH_TILE_ALIGN = 64
/** The vertices of the cube a mesh is drawn as, two triangles to a face (`DFSH_CUBE`). */
export const DFSH_CUBE_VERTICES = 36
/** The nearest and farthest the radius of a ray's cone is held to, in centimetres. */
export const DFSH_MIN_CONE_RADIUS = 0.4
export const DFSH_MAX_CONE_RADIUS = 100
/** The density of the light a thin transmitting surface lets through the meshes between it and the
 *  light, per unit of thickness: that of an opacity of 1 (`subsurfaceDensityOf`). */
export const DFSH_SUBSURFACE_DENSITY = subsurfaceDensityOf(1)
/** The steps of a ray at the qualities 1, 2 and 3 of the cascade. */
export const DFSH_STEPS = [0, 20, 32, 64] as const
/** The formats: the half-resolution result (the visibility and the depth it was traced at, a band of
 *  rows a light), and the stand-in target the scatter draws into. */
export const DFSH_HALF_FORMAT: GPUTextureFormat = 'rg32float'
export const DFSH_STAND_IN_FORMAT: GPUTextureFormat = 'rgba8unorm'
/**
 * The mask the lit image reads is a buffer of words (a storage buffer, so that the lit pass spends
 * none of the sixteen sampled textures of its stage): its first word the width of a row, then a word
 * a pixel, row by row, a lane a light, one byte each, the square root of the visibility. The words
 * a buffer of `pixels` pixels holds, and the least a stand-in holds (one: no mask).
 */
export const dfshMaskWords = (pixels: number) => 1 + pixels
export const DFSH_NO_MASK_WORDS = 1

/**
 * The corners of the cube a mesh is drawn as (`scatterWgsl.ts`): corner `c` is at `x = ±1` by its
 * bit 0, `y` by bit 1 and `z` by bit 2 (set, positive), and each face's two triangles run
 * counter-clockwise seen from outside.
 */
export const DFSH_CUBE = [
  ...[1, 3, 7, 1, 7, 5], // +x
  ...[0, 4, 6, 0, 6, 2], // -x
  ...[2, 6, 7, 2, 7, 3], // +y
  ...[0, 1, 5, 0, 5, 4], // -y
  ...[4, 5, 7, 4, 7, 6], // +z
  ...[0, 2, 3, 0, 3, 1], // -z
] as const

/**
 * The bindings, one table for every pass, so a resource has one number: a pass binds the ones it
 * names (`layouts.ts`). The depth pyramid takes three, from `depth`; the meshes' fields seven, from
 * `objects` (`meshFieldWgsl`); `flags` is the surfaces' flags, whose thin-subsurface bit the trace reads.
 */
export const DFSH_BINDING = {
  params: 0,
  depth: 1,
  culledObjects: 4,
  objectArgs: 5,
  tileCounts: 6,
  tileOffsets: 7,
  tileData: 8,
  nextOffset: 9,
  half: 10,
  mask: 11,
  final: 12,
  flags: 13,
  objects: 16,
} as const

/** The tiles a cascade whose bounding sphere has radius `radius` (centimetres) is listed in, along
 *  a side: its radius over the tile's world size `tileSize` (centimetres) and one more, at most
 *  `DFSH_MAX_TILES`, rounded up to a multiple of `DFSH_TILE_ALIGN`. */
export function shadowTileSide(radius: number, tileSize: number) {
  const tiles = Math.trunc(Math.min(radius / tileSize + 1, DFSH_MAX_TILES))
  return ceilDiv(tiles, DFSH_TILE_ALIGN) * DFSH_TILE_ALIGN
}
