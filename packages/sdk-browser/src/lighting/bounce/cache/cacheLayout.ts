import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { listBytes } from '../../../gpu/dispatch/list.ts'
import { textureBytesOf } from '../../../gpu/core/textureBytes.ts'
import { POOL_ROW_PROBES } from '../atlas.ts'

/**
 * THE RADIANCE CACHE'S SHAPES. Every probe of the world's pool (`../pool/pool.ts`) holds the light it sees in
 * every direction: an octahedral map of `resolution × resolution` texels, equal in solid angle (`equalAreaDecode`), traced from
 * the probe, filtered with its six neighbours', and read by the screen probes for the rays that leave the screen and the near
 * scene. The probes' slots are the pool's: a slot's map is the square of texels at the slot's place in the pool's rows
 * (`POOL_ROW_PROBES` along a row), so the cache has the pool's own size and the table that names a cell's slot is the pool's
 * (`../atlas.ts`).
 *
 * Two atlases that last: the RAW one, a texel the radiance a ray found (`packLight`, the 11-11-10 word) and, in the second word, the
 * distance it went, whether it met a surface and the share of it that left the scene (`cacheDepthWord`) — what the filter and the
 * readers measure by —, and the FINAL one, the radiance the filter averaged, which the readers interpolate, with the levels of
 * detail it holds (`mipmaps`, each half the side of the one before) and, where the sky is kept apart, the sky's share filtered the same.
 * A probe's final map is `cacheFinalSide` texels a side: the map and a border of `cacheBorder` texels all round it, in which the map's
 * edge is wrapped as an octahedron's, so that a bilinear read at the edge needs nothing from beyond the probe's square; each level of
 * detail keeps the border at its own scale.
 *
 * And two that last a frame, laid out by the rank of a probe in the frame's queue (`CacheTemp`: `row` probes along a row, `probes` in
 * all, the queue's own block, `probeQueueShapeOf`): the filter's output, a `resolution` square a probe, which the last pass copies, with
 * its border and levels of detail, into the final atlas; and, where the rays are cast through the scene's triangles, the TRACE atlas, the
 * rays of the tiles in the order of the tile list (`traceAtlasAt`), which a pass spreads into the raw atlas by slot.
 *
 * A map may be read once its probe is published to the cell table (`../pool/poolWgsl.ts`: a probe is published at its first trace), and
 * the update that traces it is encoded before anything reads the table that names it.
 */
export const RADIANCE_CACHE_FORMATS = {
  raw: 'rg32uint',
  final: 'r32uint',
  sky: 'r32float',
} as const satisfies Record<string, GPUTextureFormat>

/** The formats of the atlases that last a frame: the filter's output keeps the light and the sky's share as the final atlas does, the trace
 *  atlas a ray's words as the raw one does. */
export const RADIANCE_CACHE_TEMP_FORMATS = {
  filtered: RADIANCE_CACHE_FORMATS.final,
  filteredSky: RADIANCE_CACHE_FORMATS.sky,
  trace: RADIANCE_CACHE_FORMATS.raw,
} as const satisfies Record<string, GPUTextureFormat>

/** The side, in texels, of a trace tile: a workgroup. */
export const CACHE_TILE_SIDE = 8

/** Tiles along a row of the trace's own atlas, the order the tiles of the list are laid in (`traceAtlasAt`, `cacheTraceWgsl.ts`), which
 *  the light of a ray is dithered by the place of. */
export const CACHE_TRACE_ATLAS_TILES = 512

/** The flags of the cache's parameters (`flags`): the filter runs, the sky's share is kept apart, the rays go through the trace atlas, the
 *  frame is a full update. */
export const RADIANCE_CACHE_FLAGS = {
  filter: 1 << 0,
  sky: 1 << 1,
  traced: 1 << 2,
  full: 1 << 3,
} as const

/** The level every probe's trace tiles are cut at (`level`): the resolution the map is traced at, half of its side, the whole side or
 *  twice it. */
export const RADIANCE_CACHE_TILE_LEVELS = { half: 0, full: 1, supersampled: 2 } as const

/**
 * The uniform the cache's kernels read (`cache`): `resolution`, the side of a probe's map; `flags`; `mipmaps`, the levels of detail of the
 * final maps; `tempRow`, the probes along a row of the atlases of the frame; `traceTiles`, the tiles the trace atlas holds; `level`, the level the trace tiles
 * are cut at; `downsampleSq`, the square of the distance from the eye past which a probe is always traced at half the side;
 * `supersampleSq`, the square of the one within which it is traced at twice it; `filterAngle`, the angle the filter weighs by; `eye`,
 * the eye's place; `traced`, what the rays cast through the scene's triangles are made with (`probeRayTracedWgsl.ts`): how far short
 * of the probes' reach they end, in metres, the depth bias the cards are read at their hits with and the distance under which a hit
 * brings no light, in centimetres.
 */
export const RADIANCE_CACHE_PARAMS = fieldLayout('RadianceCacheParams', [
  ['resolution', 'u32'],
  ['flags', 'u32'],
  ['mipmaps', 'u32'],
  ['tempRow', 'u32'],
  ['traceTiles', 'u32'],
  ['level', 'u32'],
  ['downsampleSq', 'f32'],
  ['supersampleSq', 'f32'],
  ['filterAngle', 'f32'],
  ['eye', 'vec4f'],
  ['traced', 'vec3f'],
] as const)
/** Bytes of the cache's parameters. */
export const RADIANCE_CACHE_PARAMS_BYTES = RADIANCE_CACHE_PARAMS.words * 4

/** The most tiles a probe's map is traced in: every texel of a map twice the side. */
const maxTilesPerProbe = (resolution: number) => (resolution / (CACHE_TILE_SIDE / 2)) ** 2

/** Entries the tile list holds: every probe a frame queues, at most the whole pool of `slots` probes in a full update, each at the most tiles. */
export const cacheTileCapacity = (resolution: number, slots: number) =>
  slots * maxTilesPerProbe(resolution)

/** The extent of an atlas of a pool of `slots` probes' squares of `side` texels: the raw atlas's, of the maps of `resolution` texels. */
export function cacheExtent(side: number, slots: number): [number, number] {
  return [POOL_ROW_PROBES * side, ceilDiv(slots, POOL_ROW_PROBES) * side]
}

/** The levels of detail the fixup's kernel writes: the finest and two coarser (a cache keeps one to three). */
export const CACHE_FIXUP_LEVELS = 3

/** The border of a final map with `mipmaps` levels of detail: one texel at the finest, doubled at each level of detail, so that the coarsest
 *  keeps one. */
const cacheBorder = (mipmaps: number) => 1 << (mipmaps - 1)

/** The side of a probe's final map: the map and its border all round. */
export const cacheFinalSide = (resolution: number, mipmaps: number) =>
  resolution + 2 * cacheBorder(mipmaps)

/** The queue's block of probes the atlases of a frame are laid out by: `probes` of them, `row` along a row. */
export interface CacheTemp {
  row: number
  probes: number
}

/** The extent of the filter's output for the queue's block `temp`: a square of `resolution` texels a probe. */
export const cacheTempExtent = (resolution: number, temp: CacheTemp): [number, number] => [
  temp.row * resolution,
  ceilDiv(temp.probes, temp.row) * resolution,
]

/** The tiles the trace atlas holds for the queue's block `temp`: the tiles of every probe traced at half the side (a probe is traced at a
 *  quarter of its rays at the least), times the share that the tiles ask beyond it. A map under sixteen texels a side is one tile. */
export const cacheTraceTiles = (
  resolution: number,
  temp: CacheTemp,
  tiles: keyof typeof RADIANCE_CACHE_TILE_LEVELS,
) =>
  temp.probes * ceilDiv(resolution, 2 * CACHE_TILE_SIDE) ** 2 * (tiles === 'supersampled' ? 4 : 1)

/** The extent of the trace atlas for `tiles` tiles. */
export const cacheTraceExtent = (tiles: number): [number, number] => [
  CACHE_TRACE_ATLAS_TILES * CACHE_TILE_SIDE,
  Math.max(1, ceilDiv(tiles, CACHE_TRACE_ATLAS_TILES)) * CACHE_TILE_SIDE,
]

/** What the shape of the cache's atlases depends on beside the maps' side: the levels of detail of the final maps and whether the sky
 *  is kept apart (`ScreenProbeSettings.cache`). */
export interface CacheShape {
  resolution: number
  mipmaps: number
  skyVisibility: boolean
}

/** Whether two shapes are one cache's. */
export const sameShape = (a: CacheShape, b: CacheShape) =>
  a.resolution === b.resolution && a.mipmaps === b.mipmaps && a.skyVisibility === b.skyVisibility

/** Bytes of the atlases of a frame for the queue's block `temp` (`cacheTempExtent`): the filter's light and its sky's share (a texel where the
 *  sky is not kept apart). */
export const cacheTempBytes = (shape: CacheShape, temp: CacheTemp) => {
  const size = cacheTempExtent(shape.resolution, temp)
  return (
    textureBytesOf({ size, format: RADIANCE_CACHE_TEMP_FORMATS.filtered })! +
    textureBytesOf({
      size: shape.skyVisibility ? size : [1, 1],
      format: RADIANCE_CACHE_TEMP_FORMATS.filteredSky,
    })!
  )
}

/** Bytes of the trace atlas for `tiles` tiles. */
export const cacheTraceBytes = (tiles: number) =>
  textureBytesOf({ size: cacheTraceExtent(tiles), format: RADIANCE_CACHE_TEMP_FORMATS.trace })!

/** Bytes a cache of `slots` probes' maps of the shape `shape` holds: the atlases that last and the tile list (those of a frame, `cacheTempBytes`
 *  and `cacheTraceBytes`, come and go with the queue). */
export function cacheBytes(shape: CacheShape, slots: number) {
  const { resolution, mipmaps, skyVisibility } = shape
  const size = cacheExtent(resolution, slots)
  const finalSize = cacheExtent(cacheFinalSide(resolution, mipmaps), slots)
  return (
    textureBytesOf({ size, format: RADIANCE_CACHE_FORMATS.raw })! +
    textureBytesOf({
      size: finalSize,
      format: RADIANCE_CACHE_FORMATS.final,
      mipLevelCount: mipmaps,
    })! +
    (skyVisibility ? textureBytesOf({ size: finalSize, format: RADIANCE_CACHE_FORMATS.sky })! : 0) +
    listBytes(cacheTileCapacity(resolution, slots), 2) +
    RADIANCE_CACHE_PARAMS_BYTES
  )
}
