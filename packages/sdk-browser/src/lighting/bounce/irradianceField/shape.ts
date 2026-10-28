import { probePoolOf, type BounceShape } from '../../../../../sdk-core/src/bounce/contracts.ts'
import type {
  IrradianceFieldSettings,
  ScreenProbeSettings,
} from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'

/** The frames a probe of the irradiance field's cache that no pixel marks is kept before it is given back: the reference's (`r.RadianceCache.FramesToKeepProbes`, the cache's own default),
 *  the field sharing every other setting of the radiance caches. */
const FRAMES_TO_KEEP_PROBES = 8

/**
 * The shape of the irradiance field's cache of probes (`irradianceField*`): the levels, the cells a side of each, the growth from one to the next and the pool the atlas holds,
 * the reference's own `FRadianceCacheInputs` of the irradiance field gather (`IrradianceFieldGather.cpp:168-185`). The levels' reach is the first's extent, a half-extent in
 * metres here as everywhere in the engine's caches.
 */
export const irradianceFieldShape = (field: IrradianceFieldSettings): BounceShape => ({
  cascadeLevels: field.clipmaps,
  cascadeSize: field.gridResolution,
  cascadeHalfExtentMetres: field.worldExtent,
  cascadeBase: field.distributionBase,
  probePool: probePoolOf(field.atlasProbes),
})

/**
 * The settings the field's cache follows: the screen probes' (the trace, the filter and the tiles are the one set every radiance cache shares), with the maps' side, their
 * levels of detail and the probes traced an image the field's own, and the pixels' marks downsampled as the field asks (on top of the interpolation's reduction, `markDownsample`).
 */
export const irradianceFieldCacheSettings = (screen: ScreenProbeSettings): ScreenProbeSettings => {
  const field = screen.irradianceField
  return {
    ...screen,
    radianceCache: true,
    cache: {
      ...screen.cache,
      resolution: field.probeResolution,
      budget: field.budget,
      framesToKeepProbes: FRAMES_TO_KEEP_PROBES,
      mipmaps: field.mipmaps,
      markDownsample: field.markDownsample * field.interpolateDownsample,
      skyVisibility: false,
      calculatesIrradiance: true,
      // Its own colour of leaking: the image writes the view's before the cache reads it (`encodeIrradianceField`).
      skylightLeak: [0, 0, 0],
    },
  }
}

/**
 * The extents of the atlases the field's probes keep beside the radiance cache's own (`CalculateIrradiance`, `RadianceCache.cpp:2640-2700`): the irradiance maps — a probe's square of
 * `irradianceResolution` texels with a border of one all round, so that a bilinear read at its edge needs nothing beyond it (the reference's `+ 2` border) — and the occlusion maps likewise,
 * `rowProbes` probes along a row of the pool (`probeRowOf`), the rows the pool holds.
 */
export function irradianceFieldAtlases(
  field: IrradianceFieldSettings,
  rowProbes: number,
  pool: number,
) {
  const rows = Math.ceil(pool / rowProbes)
  const extent = (resolution: number) =>
    [rowProbes * (resolution + 2), rows * (resolution + 2)] as const
  return {
    irradiance: extent(field.irradianceResolution),
    occlusion: extent(field.occlusionResolution),
  }
}
