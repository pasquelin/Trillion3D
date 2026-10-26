import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { SCREEN_PROBE_CONSTANTS } from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import { BOUNCE_PROBE_QUEUE } from '../../../../../sdk-core/src/bounce/contracts.ts'
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
 * Two atlases: the RAW one, a texel the radiance a ray found (`packLight`, the 11-11-10 word) and, in the second word, the
 * distance it went, whether it met a surface and the share of it that left the scene (`cacheDepthWord`) — what the filter and the
 * readers measure by —, and the FINAL one, the radiance the filter averaged, which the readers interpolate, with the levels of
 * detail it holds (`mipmaps`, each half the side of the one before) and, where the sky is kept apart, the sky's share filtered the same. The tags — which cell of which level a slot's final map
 * was made for — say whether a map may be read; the importance functions — nine harmonics and a count a slot, summed by the
 * screen probes — say where the pixels look.
 */
export const RADIANCE_CACHE_FORMATS = {
  raw: 'rg32uint',
  final: 'r32uint',
  sky: 'r32float',
} as const satisfies Record<string, GPUTextureFormat>

/** Words of a slot's tag: the cell's three coordinates and the level plus one (zero for a map never made). */
export const CACHE_TAG_WORDS = 4

/** Words of a slot's importance function: nine harmonics and the count of the screen probes that gave them. */
export const CACHE_PDF_WORDS = SCREEN_PROBE_CONSTANTS.radiancePdfCoefficients

/** The side, in texels, of a trace tile: a workgroup. */
export const CACHE_TILE_SIDE = 8

/** The flags of the cache's parameters (`size.y`). */
export const RADIANCE_CACHE_FLAGS = { importance: 1 << 0, filter: 1 << 1, sky: 1 << 2 } as const

/** The trace tiles' modes (`size.z`): the pixels choose (`adaptive`), or one level for every probe. */
export const RADIANCE_CACHE_TILE_MODES = { adaptive: 0, half: 1, full: 2, supersampled: 3 } as const

/**
 * The uniform the cache's kernels read (`cache`): `size`, the side of a probe's map, the flags, the tile mode and the probes
 * the image queued; `distances`, the square of the distance from the eye past which a probe is always traced at half the
 * side, the square of the one within which it may be supersampled, the share of the pixels' lobes above which a tile is
 * traced again, and the angle the filter weighs by; `eye`, the eye's place.
 */
export const RADIANCE_CACHE_PARAMS = fieldLayout('RadianceCacheParams', [
  ['size', 'vec4u'],
  ['distances', 'vec4f'],
  ['eye', 'vec4f'],
] as const)
/** Bytes of the cache's parameters. */
export const RADIANCE_CACHE_PARAMS_BYTES = RADIANCE_CACHE_PARAMS.words * 4

/** The most tiles a probe's map is traced in: every texel of a map twice the side. */
const maxTilesPerProbe = (resolution: number) => (resolution / (CACHE_TILE_SIDE / 2)) ** 2

/** Entries the tile list holds: every probe a frame queues, each at the most tiles. */
export const cacheTileCapacity = (resolution: number) =>
  BOUNCE_PROBE_QUEUE * maxTilesPerProbe(resolution)

/** The extent of the atlases for a pool of `slots` probes' maps of `resolution` texels a side. */
export function cacheExtent(resolution: number, slots: number): [number, number] {
  return [POOL_ROW_PROBES * resolution, ceilDiv(slots, POOL_ROW_PROBES) * resolution]
}

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

/** Bytes a cache of `slots` probes' maps of the shape `shape` holds: the atlases, the tags, the importance functions
 *  and the tile list. */
export function cacheBytes(shape: CacheShape, slots: number) {
  const { resolution, mipmaps, skyVisibility } = shape
  const size = cacheExtent(resolution, slots)
  return (
    textureBytesOf({ size, format: RADIANCE_CACHE_FORMATS.raw })! +
    textureBytesOf({ size, format: RADIANCE_CACHE_FORMATS.final, mipLevelCount: mipmaps })! +
    (skyVisibility ? textureBytesOf({ size, format: RADIANCE_CACHE_FORMATS.sky })! : 0) +
    slots * (CACHE_TAG_WORDS + CACHE_PDF_WORDS) * 4 +
    listBytes(cacheTileCapacity(resolution), 2) +
    RADIANCE_CACHE_PARAMS_BYTES
  )
}
