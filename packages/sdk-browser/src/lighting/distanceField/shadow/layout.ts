import { alignUp, ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { fieldLayout, vec4Array } from '../../../gpu/core/fieldLayout.ts'

/**
 * THE SUNS' MESH LISTS OF THE SURFACE CACHE, laid out once for the host that fills them and the programs that
 * read them (`params.ts`, `*Wgsl.ts`). The meshes that cast a shadow are culled to the volume the cache's cards are
 * kept in, listed by tile of a shadow space across a sun (the grid of tiles), and traced through their distance fields
 * (`../meshFieldWgsl.ts`) by the cards' direct light (`../../surfaceCache/lighting/meshShadow.ts`). Lengths are
 * centimetres, the unit of the fields; positions are the eye's, so that a float holds them whatever the distance from
 * the origin.
 *
 * `DfshParams`, one a sun (the passes of a sun read it at their own offset of one buffer):
 *  - `toShadow` takes a position from the eye to the sun's shadow space — the light's right and up over the
 *    bounding sphere's radius, then the distance toward the light from that sphere's far side over the same
 *    radius —, `planes` the culling hull, `count` of them in `counts.x`;
 *  - `eyeHigh` and `eyeLow` the eye as a pair of floats (xyz); `light` the unit direction toward the light,
 *    `trace` the steps of a ray (its third word);
 *  - `range` the factor on a two-sided mesh's bias (its third word) and the mesh bias of the rays (its fourth),
 *    `expand` the world radius each mesh's box is grown by where it is listed (one tile's half diagonal) and the
 *    shadow-space length of the widest cone radius;
 *  - `lists` the first entry of the sun's lists in the store (its first word) and, for the cards' pass that reads the lists from one buffer
 *    (`../../surfaceCache/lighting/meshShadow.ts`), where the arrays of the start offsets, of the counts and of the entries begin in it (its other three words); `tiles` the tile grid's side, the
 *    entries its lists hold, the meshes of the scene and the entries each tile has a place for when the lists are
 *    not compacted; `counts` the planes, the vertex count of the cube a mesh is drawn as, the first tile of the sun
 *    in the store, the flags (`DFSH_FLAG`).
 */
export const DFSH_PARAMS = fieldLayout('DfshParams', [
  ['toShadow', 'mat4x4f'],
  ['planes', vec4Array(12)],
  ['eyeHigh', 'vec4f'],
  ['eyeLow', 'vec4f'],
  ['light', 'vec4f'],
  ['trace', 'vec4f'],
  ['range', 'vec4f'],
  ['expand', 'vec4f'],
  ['lists', 'vec4u'],
  ['tiles', 'vec4u'],
  ['counts', 'vec4u'],
] as const)

/** Bytes of one sun's uniform, and the stride the frame's suns' are laid at (a dynamic offset
 *  is a multiple of 256). */
export const DFSH_PARAMS_BYTES = DFSH_PARAMS.words * 4
export const DFSH_PARAMS_STRIDE = alignUp(DFSH_PARAMS_BYTES, 256)

/** The bits of `counts.w`. */
export const DFSH_FLAG = {
  /** The tiles' lists lie one after the other, from the start offsets (`distanceFieldShadowCompactTiles`),
   *  else each tile has a place of its own. */
  compactTiles: 1,
} as const

/** The suns a frame lists the meshes for, the first four. */
export const DFSH_MAX_LIGHTS = 4
/** The planes of the culling hull of the cards' volume across a sun. */
export const DFSH_PLANES = 12
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
/** The farthest the radius of a ray's cone is held to, in centimetres. */
export const DFSH_MAX_CONE_RADIUS = 100
/** The steps of a ray at the qualities 1, 2 and 3. */
export const DFSH_STEPS = [0, 20, 32, 64] as const
/** The least half-range of the shadow space's depth, in centimetres: a small volume still sees the
 *  meshes this far toward the light and past it. */
export const DFSH_MIN_DEPTH_RANGE = 5000
/** The shadow space snaps its origin to a grid of this many texels a step, on a map of
 *  `distanceFieldShadowSnapResolution` texels less this border on each side. */
export const DFSH_SNAP_STEP_TEXELS = 4
export const DFSH_SNAP_BORDER = 4
/** The least resolution the snap's map is taken to have, before the border is taken off. */
export const DFSH_MIN_SNAP_RESOLUTION = 32
/** The stand-in target the scatter draws into. */
export const DFSH_STAND_IN_FORMAT: GPUTextureFormat = 'rgba8unorm'

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
 * names (`layouts.ts`). The meshes' fields take seven, from `objects` (`meshFieldWgsl`).
 */
export const DFSH_BINDING = {
  params: 0,
  culledObjects: 4,
  objectArgs: 5,
  tileCounts: 6,
  tileOffsets: 7,
  tileData: 8,
  nextOffset: 9,
  objects: 16,
} as const

/** The tiles a volume whose bounding sphere has radius `radius` (centimetres) is listed in, along
 *  a side: its radius over the tile's world size `tileSize` (centimetres) and one more, at most
 *  `DFSH_MAX_TILES`, rounded up to a multiple of `DFSH_TILE_ALIGN`. */
export function shadowTileSide(radius: number, tileSize: number) {
  const tiles = Math.trunc(Math.min(radius / tileSize + 1, DFSH_MAX_TILES))
  return ceilDiv(tiles, DFSH_TILE_ALIGN) * DFSH_TILE_ALIGN
}
