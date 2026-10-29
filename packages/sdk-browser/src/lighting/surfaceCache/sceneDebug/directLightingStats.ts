import type { SurfaceCacheSettings } from '../../../../../sdk-core/src/contracts/surfaceCacheOptions.ts'
import { LIGHT_KIND } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import { cloudShadowOfLight } from '../../../../../sdk-core/src/scene/light/lightCloudShadow.ts'
import { CARD_TILE_SIZE } from '../../../../../sdk-core/src/lighting/surfaceCache/cardResolution.ts'
import {
  lightTilesPerType,
  updateTilesOf,
} from '../../../../../sdk-core/src/lighting/surfaceCache/lightingMath.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { standaloneLightFunctions } from '../../lightFunction/frame.ts'
import { CONTEXT_ARGS, CONTEXT_AT } from '../lighting/layout.ts'

/**
 * THE DIRECT LIGHTING STATS TABLE (`surfaceCacheLightingStats` 3): what the lights of the direct update are, counted on the host as the
 * update gathers them — a light that needs a shadow mask casts a shadow, wears a light function or, a sun, may cast a cloud transmittance, and
 * is batched with the lights of its type unless it is a sun, may cast a cloud transmittance or wears a light function the atlas holds no slot of —
 * and the figures of the update the context's header holds. Pure counts and words, no GPU.
 */

/** The lights the direct update gathers, as the table counts them. */
export interface DirectLightCounts {
  lights: number
  batched: number
  standalone: number
  rect: boolean
  lightFunctions: boolean
  ies: boolean
}

/** The lights of the scene sorted as the direct update gathers them. */
export function directLightCounts(
  rt: WebgpuPagesRuntime,
  settings: SurfaceCacheSettings,
): DirectLightCounts {
  const { store } = rt.lights
  const functions = rt.views.active.overrides.lightFunctions && store.lightFunctionCount > 0
  const unbatched = new Set<number>(
    functions ? standaloneLightFunctions(rt).map((l) => l.slot) : [],
  )
  const perType = lightTilesPerType(settings.surfaceCacheDirectLightingBatchShadows)
  const counts: DirectLightCounts = {
    lights: store.count,
    batched: 0,
    standalone: 0,
    rect: false,
    lightFunctions: functions,
    ies: false,
  }
  for (let slot = 0; slot < store.count; slot++) {
    const light = store.light(store.ids[slot]!)
    if (!light) continue
    const kind = store.kindOf(slot)
    const sun = kind === LIGHT_KIND.directional
    const clouds =
      sun &&
      settings.surfaceCacheDirectLightingCloudTransmittance &&
      !!cloudShadowOfLight(light).castCloudShadows
    const wearing = functions && light.lightFunction !== undefined
    counts.rect ||= kind === LIGHT_KIND.rect
    counts.ies ||= light.iesProfile !== undefined
    if (!(light.castsShadow || clouds || wearing)) continue
    if (perType && !sun && !clouds && !unbatched.has(slot)) counts.batched++
    else counts.standalone++
  }
  return counts
}

/** The lines of the table: the views and lights, the atlas, the trace and the cards and tiles the update lights, from the counts, the atlas `side` in texels, the settings and the header `words` of the context buffer. */
export function directLightingStatsLines(
  counts: DirectLightCounts,
  side: number,
  settings: SurfaceCacheSettings,
  words: ArrayLike<number>,
): string[] {
  const tiles = updateTilesOf(settings, side).direct
  const update = Math.sqrt(tiles) * CARD_TILE_SIZE
  // The reference counts the traces the update compacted; ours are the groups of 64 shadow traces the header holds, an overestimate as its count is without the stochastic path.
  const traces = words[CONTEXT_AT.args + 4 * CONTEXT_ARGS.shadowTraces]! * 64
  return [
    'Surface Cache Direct Lighting',
    '#Views       : 1',
    `#Lights      : ${counts.lights}`,
    '',
    'Lights',
    `Batched Lights   : ${counts.batched}`,
    `Standalone Lights: ${counts.standalone}`,
    `Rect lights      : ${String(counts.rect)}`,
    `Light functions  : ${String(counts.lightFunctions)}`,
    `IES lights       : ${String(counts.ies)}`,
    '',
    'Atlas',
    `AtlasResolution: ${side} ${side}`,
    `UpdateAtlasSize: ${update} ${update}`,
    `MaxUpdateTiles : ${tiles}`,
    `UpdateFactor   : ${settings.surfaceCacheDirectLightingUpdateFactor}`,
    '',
    'Trace',
    `Method     : ${settings.surfaceCacheDirectLightingHardwareRayTracing ? 'Hardware' : 'Software'}`,
    `RT Traces  : ${traces}`,
    '',
    'Card',
    `Updating Card  : ${words[CONTEXT_AT.pagesListed]}`,
    `Updating Tiles : ${words[CONTEXT_AT.allocated]}`,
  ]
}
