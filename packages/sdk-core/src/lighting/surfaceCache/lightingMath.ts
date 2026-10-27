import { ceilDiv, nextPow2 } from '../../../../math/src/scalar/integers.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import type { SurfaceCacheSettings } from '../../contracts/surfaceCacheOptions.ts'
import { CARD_TILE_SIZE, PAGE_SIZE } from './cardResolution.ts'

/**
 * THE SIZES OF THE SURFACE CACHE'S LIGHTING, as numbers: what the host makes its buffers by and the kernels are
 * compiled for (`packages/sdk-browser/src/lighting/surfaceCache/lighting/`). The laws the kernels themselves run — the
 * priority of a page, the cut, the lights a tile keeps, the shadow ray's bias, the final light — are held to their
 * reference by `lightingOracle.fixture.ts`.
 *
 * Two kinds of update run each image, the direct light and the radiosity (`LIGHTING_CONTEXTS`), each over a share of
 * the atlas's tiles of 8 × 8 texels, the pages left longest unlit, and nearest, first (`PRIORITY_HISTOGRAM_SIZE` buckets).
 */

/** The two updates of an image: the direct light and the radiosity. */
export const LIGHTING_CONTEXTS = { direct: 0, indirect: 1 } as const
/** The buckets of the priority histogram. */
export const PRIORITY_HISTOGRAM_SIZE = 16

/**
 * The tiles an update of a `side` atlas lights in an image: the atlas's texels over `factor` divided by `speed` (rounded,
 * held from 1 to 1024; 1 for `forceFull`), a square of whole tiles that is at least one page.
 */
function updateTiles(side: number, factor: number, speed: number, forceFull: boolean) {
  const divisor = forceFull ? 1 : clamp(Math.round(factor / speed), 1, 1024)
  const along = Math.max(
    ceilDiv(side / Math.sqrt(divisor) + 0.5, CARD_TILE_SIZE) * CARD_TILE_SIZE,
    PAGE_SIZE,
  )
  return (along / CARD_TILE_SIZE) ** 2
}

/** The tiles each update lights in an image of a `side` atlas, under `settings`. */
export const updateTilesOf = (settings: SurfaceCacheSettings, side: number) => ({
  direct: updateTiles(
    side,
    settings.surfaceCacheDirectLightingUpdateFactor,
    settings.surfaceCacheLightingUpdateSpeed,
    settings.surfaceCacheLightingForceFullUpdate,
  ),
  indirect: updateTiles(
    side,
    settings.surfaceCacheRadiosityUpdateFactor,
    settings.surfaceCacheLightingUpdateSpeed,
    settings.surfaceCacheLightingForceFullUpdate,
  ),
})

/** The most lights a tile keeps: a tile's lights are counted in arrays of this size, and the setting is held to it. */
export const MAX_LIGHTS_PER_TILE = 32

/** The lights a tile keeps: at most `n` raised to a power of two, held from 1 to `MAX_LIGHTS_PER_TILE`. */
export const lightsPerTile = (n: number) => nextPow2(clamp(Math.round(n), 1, MAX_LIGHTS_PER_TILE))

/** The probes' spacing in texels: the setting raised to a power of two and held from 1 to 8, halved from quality 6. */
export const probeSpacing = (setting: number, quality: number) =>
  nextPow2(clamp(quality >= 6 ? Math.trunc(setting / 2) : setting, 1, CARD_TILE_SIZE))

/** A probe's hemisphere side in rays: the setting times the square root of the quality (from 0.5 to 4), from 1 to 16. */
export const hemisphereResolution = (setting: number, quality: number) =>
  clamp(Math.trunc(setting * Math.sqrt(clamp(quality, 0.5, 4))), 1, 16)
