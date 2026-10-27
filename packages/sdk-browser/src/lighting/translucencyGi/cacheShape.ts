import {
  BOUNCE_MAX_LEVELS,
  probePoolOf,
  type BounceShape,
} from '../../../../sdk-core/src/bounce/contracts.ts'
import type { ScreenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import type { TranslucencyGiValues } from '../../../../sdk-core/src/contracts/translucencyGiOptions.ts'

/** The frames a probe of the volume's cache that nothing reads is kept before it is given back. */
const FRAMES_TO_KEEP_PROBES = 8

/** The scale of the nearest a probe's ray starts at, over its cell's diagonal, where the cells march no distance field themselves and the
 *  cache's light must connect closer to them. */
const MIN_TRACE_SCALE_WITHOUT_MARCH = 0.1

/**
 * The levels a cache reaching `distance` holds: the first whose reach (`extent` times `base` to the level) is past it ends the count, one more
 * level than those before it, at least one and at most what the uniform of the levels has room for.
 */
export function clipmapsCovering(distance: number, extent: number, base: number) {
  let level = 0
  while (level < BOUNCE_MAX_LEVELS && extent * base ** level <= distance) level++
  return Math.min(Math.max(level + 1, 1), BOUNCE_MAX_LEVELS)
}

/** The shape of the volume's own cache: as many levels as cover the volume's end distance `end` (`translucencyGiEndDistanceOf`), their cells
 *  and growth, and the pool the atlas holds. */
export const translucencyCacheShape = (v: TranslucencyGiValues, end: number): BounceShape => ({
  cascadeLevels: clipmapsCovering(
    end,
    v.translucencyGiRadianceCacheClipmapWorldExtent,
    v.translucencyGiRadianceCacheClipmapDistributionBase,
  ),
  cascadeSize: v.translucencyGiRadianceCacheGridResolution,
  cascadeHalfExtentMetres: v.translucencyGiRadianceCacheClipmapWorldExtent,
  cascadeBase: v.translucencyGiRadianceCacheClipmapDistributionBase,
  probePool: probePoolOf(v.translucencyGiRadianceCacheProbeAtlasResolutionInProbes),
})

/**
 * The settings the volume's own cache follows: the screen probes' (the cache's trace, filter and tiles are the one set of settings every
 * cache shares) with the maps' side, their levels of detail, the probes traced an image and the scale of the nearest a ray starts at the
 * volume's own, no sky apart from the light, the probes kept the frames a cache of the volume keeps them.
 */
export const translucencyCacheSettings = (
  screen: ScreenProbeSettings,
  v: TranslucencyGiValues,
): ScreenProbeSettings => ({
  ...screen,
  radianceCache: true,
  cache: {
    ...screen.cache,
    resolution: v.translucencyGiRadianceCacheProbeResolution,
    budget: v.translucencyGiRadianceCacheNumProbesToTraceBudget,
    framesToKeepProbes: FRAMES_TO_KEEP_PROBES,
    mipmaps: v.translucencyGiRadianceCacheNumMipmaps,
    skyVisibility: false,
    minTraceScale: v.translucencyGiTraceFromVolume ? 1 : MIN_TRACE_SCALE_WITHOUT_MARCH,
  },
})
