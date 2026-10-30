import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { listBytes } from '../../../gpu/dispatch/list.ts'
import { textureBytesOf } from '../../../gpu/core/textureBytes.ts'
import type { LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { lightWordsOf } from '../../../gpu/core/lightWords.ts'
import { POOL_ROW_PROBES } from '../atlas.ts'

/** The raw atlas's format where the light is one word (the 11-11-10 format, native or not): two words a texel, the light's and the ray's distance word. */
const RADIANCE_RAW_FORMAT = 'rg32uint' as const

/** The raw atlas's format for a light stored in `light`: a texel is the words of the light (`lightWordsOf`) and the ray's distance word beside them, which
 *  the light's one word and the distance fill, else the four words of a vector (the light's two or three, the distance last). */
export const radianceRawFormat = (light: LightAtlasFormat) =>
  lightWordsOf(light) === 1 ? RADIANCE_RAW_FORMAT : ('rgba32uint' as const)

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
 *
 * The light of the final atlas (and of the filter's output) is stored in the format the lighting data format asks (`CacheShape.light`,
 * `../../../gpu/core/lightAtlasFormat.ts`); the raw atlas, and the trace atlas, hold the light in the words of that format beside the distance word (`radianceRawFormat`),
 * so that no ray's light is rounded to the 11-11-10 floats' mantissas where the format asks for more.
 */
export const radianceCacheFormats = (light: LightAtlasFormat) =>
  ({
    raw: radianceRawFormat(light),
    final: light,
    sky: 'r32float',
  }) as const satisfies Record<string, GPUTextureFormat>

/** The formats of the atlases that last a frame: the filter's output keeps the light and the sky's share as the final atlas does, the trace
 *  atlas a ray's words as the raw one does. */
export const radianceCacheTempFormats = (light: LightAtlasFormat) => {
  const held = radianceCacheFormats(light)
  return { filtered: held.final, filteredSky: held.sky, trace: held.raw } as const
}

/** The side, in texels, of a trace tile: a workgroup. */
export const CACHE_TILE_SIDE = 8

/** Tiles along a row of the trace's own atlas, the order the tiles of the list are laid in (`traceAtlasAt`, `cacheTraceWgsl.ts`), which
 *  the light of a ray is dithered by the place of. */
export const CACHE_TRACE_ATLAS_TILES = 512

/** The flags of the cache's parameters (`flags`): the filter runs, the sky's share is kept apart, the rays go through the trace atlas. */
export const RADIANCE_CACHE_FLAGS = {
  filter: 1 << 0,
  sky: 1 << 1,
  traced: 1 << 2,
  /** The rays cast through the scene's triangles add the leaking sky light (`leak`): the cache makes irradiance maps. */
  leak: 1 << 3,
} as const

/** The level every probe's trace tiles are cut at (`level`): the resolution the map is traced at, half of its side, the whole side or
 *  twice it. */
export const RADIANCE_CACHE_TILE_LEVELS = {
  automatic: 1,
  half: 0,
  full: 1,
  supersampled: 2,
} as const

/** Words a probe keeps in the buffer of the lobes the screen probes want light in (`pdf`): the nine harmonics' sums, and the weight they were summed with. */
export const CACHE_PDF_WORDS = 10

/** The units a harmonic's coefficient is summed in (an integer atomic holds the sums of the screen probes round a world probe): the largest whole count of
 *  them a signed word holds, over a hundred thousand (the reference sizes it for an unsigned word in a signed buffer, which wraps at half the sums). */
export const CACHE_PDF_UNITS = 2147483647 / 100000

/**
 * The uniform the cache's kernels read (`cache`): `resolution`, the side of a probe's map; `flags`; `mipmaps`, the levels of detail of the
 * final maps; `tempRow`, the probes along a row of the atlases of the frame; `traceTiles`, the tiles the trace atlas holds; `level`, the level the trace tiles
 * are cut at; `downsampleSq`, the square of the distance from the eye past which a probe is always traced at half the side;
 * `supersampleSq`, the square of the one within which it is traced at twice it; `tileThreshold`, the value of the screen probes' lobes above which a tile is traced at the next level
 * where the tiles follow them; `filterAngle`, the angle the filter weighs by; `eye`,
 * the eye's place; `traced`, what the rays cast through the scene's triangles are made with (`probeRayTracedWgsl.ts`): how far short
 * of the probes' reach they end, in metres, the depth bias the cards are read at their hits with and the distance under which a hit
 * brings no light, in centimetres; `lit`, the word of the hit lighting's mode when the rays' hits are lit where they stand (`hitLightWord`), zero otherwise, and `litExposure`, the exposure of the image the update was queued in (its view's last, as the CPU knows it), which the lights' strength is read under.
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
  ['tileThreshold', 'f32'],
  ['filterAngle', 'f32'],
  ['eye', 'vec4f'],
  ['traced', 'vec3f'],
  ['leak', 'vec4f'],
  ['leakDistance', 'f32'],
  ['lit', 'u32'],
  ['litExposure', 'f32'],
] as const)
/** Bytes of the cache's parameters. */
export const RADIANCE_CACHE_PARAMS_BYTES = RADIANCE_CACHE_PARAMS.words * 4

/** The most tiles a probe's map is traced in: every texel of a map twice the side. */
const maxTilesPerProbe = (resolution: number) => (resolution / (CACHE_TILE_SIDE / 2)) ** 2

/** Entries the tile list holds: every probe a frame queues, at most the whole pool of `slots` probes in a full update, each at the most tiles,
 *  and the last one the cell the first tile of the slice of the list being traced is kept in (`advanceSlice`). */
export const cacheTileCapacity = (resolution: number, slots: number) =>
  slots * maxTilesPerProbe(resolution) + 1

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

/** The most tiles the trace atlas holds: the rows of a texture of the side every device grants at least (8192 texels; `limits.ts` checks the device's own). */
const MAX_TRACE_ATLAS_TILES = CACHE_TRACE_ATLAS_TILES * (8192 / CACHE_TILE_SIDE)

/** The tiles the trace atlas holds for the queue's block `temp`: the most the list can hold, every probe at twice the side (the lobes cut a
 *  probe's tiles to three levels past the first, near the eye; the reference sizes its tile buffer by the same worst case), no more than the
 *  atlas can, the rest of the tiles being traced in further slices (`cacheTraceSlices`). */
export const cacheTraceTiles = (resolution: number, temp: CacheTemp) =>
  Math.min(temp.probes * maxTilesPerProbe(resolution), MAX_TRACE_ATLAS_TILES)

/** The slices the tiles are traced in, `traceTiles` of them at a time: the tiles of every probe of the block `temp` at the most (all at twice
 *  the side), over what the atlas holds. One while the atlas holds them all. */
export const cacheTraceSlices = (resolution: number, temp: CacheTemp, traceTiles: number) =>
  Math.max(1, ceilDiv(temp.probes * maxTilesPerProbe(resolution), traceTiles))

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
  /** The format the final maps and the filter's light are stored in (`lightingDataFormat` on the device's features, `lightAtlasFormat`). */
  light: LightAtlasFormat
}

/** Whether two shapes are one cache's. */
export const sameShape = (a: CacheShape, b: CacheShape) =>
  a.resolution === b.resolution &&
  a.mipmaps === b.mipmaps &&
  a.skyVisibility === b.skyVisibility &&
  a.light === b.light

/** Bytes of the atlases of a frame for the queue's block `temp` (`cacheTempExtent`): the filter's light and its sky's share (a texel where the
 *  sky is not kept apart). */
export const cacheTempBytes = (shape: CacheShape, temp: CacheTemp) => {
  const size = cacheTempExtent(shape.resolution, temp)
  const formats = radianceCacheTempFormats(shape.light)
  return (
    textureBytesOf({ size, format: formats.filtered })! +
    textureBytesOf({
      size: shape.skyVisibility ? size : [1, 1],
      format: formats.filteredSky,
    })!
  )
}

/** The format of the texture the radiance cache's trace marks its hits in (the hit lighting): the mark word (`cacheLitMark.ts`), the distance of the hit and the two words of the tile list's entry the ray was traced from, which tell the passes that light the hit its probe. */
export const CACHE_LIT_MARKS_FORMAT = 'rgba32uint' as const

/** Bytes of the trace atlas for `tiles` tiles, its rays' light stored in `light`; with `marked` the texture its hits are marked in (`CACHE_LIT_MARKS_FORMAT`) is held beside. */
export const cacheTraceBytes = (tiles: number, light: LightAtlasFormat, marked = false) =>
  textureBytesOf({ size: cacheTraceExtent(tiles), format: radianceRawFormat(light) })! +
  (marked ? textureBytesOf({ size: cacheTraceExtent(tiles), format: CACHE_LIT_MARKS_FORMAT })! : 0)

/** Bytes a cache of `slots` probes' maps of the shape `shape` holds: the atlases that last and the tile list (those of a frame, `cacheTempBytes`
 *  and `cacheTraceBytes`, come and go with the queue). */
export function cacheBytes(shape: CacheShape, slots: number) {
  const { resolution, mipmaps, skyVisibility } = shape
  const formats = radianceCacheFormats(shape.light)
  const size = cacheExtent(resolution, slots)
  const finalSize = cacheExtent(cacheFinalSide(resolution, mipmaps), slots)
  return (
    textureBytesOf({ size, format: formats.raw })! +
    textureBytesOf({
      size: finalSize,
      format: formats.final,
      mipLevelCount: mipmaps,
    })! +
    (skyVisibility ? textureBytesOf({ size: finalSize, format: formats.sky })! : 0) +
    listBytes(cacheTileCapacity(resolution, slots), 2) +
    slots * CACHE_PDF_WORDS * 4 +
    RADIANCE_CACHE_PARAMS_BYTES
  )
}
