// The maps the frame's casting lights take (`engineVsm.ts`): a clipmap's levels a sun, six faces a
// point light, one a spot; the full maps a set is first made for, the mask's lights, the raster's
// views, and the set's options for them.
import { alignUp } from '../../../../../../math/src/scalar/integers.ts'
import { vsmPoolPagesBound } from '../layoutBytes.ts'
import type { VsmFrameLight } from '../frameSetup.ts'
import { vsmShadowed } from '../seenLights.ts'
import {
  POOL_PAGES_X,
  VSM_TABLES_PER_ROW,
  type VsmLayout,
  type VsmResourceOptions,
} from '../layout.ts'
import { VSM_DEFAULT_SUN_LEVELS, type VsmViewLight } from '../mapViews.ts'
import { vsmViewPasses } from '../render/renderViewPasses.ts'
import type { VsmMaskNeeds } from './vsmMask.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { readShadowSetting } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'

/** The clipmap levels the sun of `entry` takes at most. */
const sunLevelsOf = (entry: VsmFrameLight) => entry.sunLevels ?? VSM_DEFAULT_SUN_LEVELS
/** Room for `maps` page-table blocks, rounded up to whole page-table rows. */
export const wholeTableRows = (maps: number) => alignUp(maps, VSM_TABLES_PER_ROW)

/** Page-table blocks a set is first made for: its suns' clipmap levels, with room for the
 *  unreferenced entries the cache keeps ten frames, rounded to whole page-table rows — one row at
 *  least, which holds a sun and more maps with that room. A local light's table is sized by its
 *  finest mip (`tableBlocks.ts`): a far one takes one entry of a block, so the blocks a frame plans
 *  follow the lights near its eye, and the plan grows the tables to them in the same frame
 *  (`planVirtualShadowFrame`, `grow`). */
export function fullMapsFor(lights: readonly VsmFrameLight[]) {
  return wholeTableRows(2 * sunMapsFor(lights, 0) + 16)
}

/** The frame's lights it shadows (`vsmShadowed`). */
export function castingCount(lights: readonly VsmFrameLight[]) {
  let count = 0
  for (const entry of lights) if (vsmShadowed(entry)) count++
  return count
}

/** What the frame's masks are made for (`VsmMaskNeeds`): a layer for each sun it shadows and the most local
 *  lights a pixel keeps (`shadowOnePassProjectionMaxLightsPerPixel`). */
export function maskNeedsFor(
  rt: WebgpuPagesRuntime,
  lights: readonly VsmFrameLight[],
): VsmMaskNeeds {
  let suns = 0
  for (const entry of lights) if (vsmShadowed(entry) && entry.light.kind === 'directional') suns++
  return { suns, localLights: readShadowSetting(rt, 'shadowOnePassProjectionMaxLightsPerPixel') }
}

/** The frame's casting lights (`vsmShadowed`) as the raster's views count them, rewritten by each
 *  `renderViewBound`. */
const casting: VsmViewLight[] = []
/** The casting lights, and the most views one of the raster's view passes holds, in the `passes`
 *  of them (`vsmViewPasses`, `limit` the maps a pass lists), before their maps are set up: as the
 *  raster's lists are sized. */
export function renderViewBound(lights: readonly VsmFrameLight[], limit: number) {
  let count = 0
  for (const entry of lights)
    if (vsmShadowed(entry)) {
      const kind = entry.light.kind
      casting[count++] = { kind, count: kind === 'directional' ? sunLevelsOf(entry) : undefined }
    }
  casting.length = count
  const { list, mostMaps } = vsmViewPasses(casting, limit)
  return { lights: count, raster: { viewWords: 4 * (count + mostMaps), passes: list.length } }
}

/** The clipmap maps the frame's suns take at most, the receiver cover's size: those of `least`
 *  maps at least, a sun's own by default (the cover holds one sun when none casts). */
export function sunMapsFor(lights: readonly VsmFrameLight[], least = VSM_DEFAULT_SUN_LEVELS) {
  let maps = 0
  for (const entry of lights)
    if (vsmShadowed(entry) && entry.light.kind === 'directional') maps += sunLevelsOf(entry)
  return Math.max(least, maps)
}

/**
 * The physical pages the set asks, fixed: the setting's most pages (`shadowMaxPhysicalPages`) rounded
 * up to whole rows of the pool, as the reference rounds them,
 * never past the pages one binding of the device holds (`vsmPoolPagesBound`).
 */
function vsmPoolAsked(rt: WebgpuPagesRuntime) {
  return Math.min(
    vsmPoolPagesBound(rt.gpu.device!.limits),
    alignUp(Math.max(1, readShadowSetting(rt, 'shadowMaxPhysicalPages')), POOL_PAGES_X),
  )
}

/** What a set is kept for, besides its maps: the physical pages, the occlusion culling's pyramid
 *  (`occlusion`) and its second layer for the dynamic casters (`dynamicHzb`), the pages kept from
 *  one frame to the next (`cacheEnabled`), the receiver cover of every map (`localCover`). */
export type VsmAsked = {
  poolPages: number
  occlusion: boolean
  dynamicHzb: boolean
  cacheEnabled: boolean
  localCover: boolean
}

/** What the settings ask of the frame's set (`shadowMaxPhysicalPages`, `shadowOcclusionCulling`,
 *  `shadowDynamicHzb`, `shadowCache`, `shadowUseReceiverMaskLocal`). */
export const vsmAsked = (rt: WebgpuPagesRuntime): VsmAsked => ({
  poolPages: vsmPoolAsked(rt),
  occlusion: readShadowSetting(rt, 'shadowOcclusionCulling'),
  dynamicHzb: readShadowSetting(rt, 'shadowDynamicHzb'),
  cacheEnabled: readShadowSetting(rt, 'shadowCache'),
  localCover: readShadowSetting(rt, 'shadowUseReceiverMaskLocal'),
})

/** What a set of `layout` holds of it: its pool, and whether it has the pyramid, its second layer,
 *  the kept pages and the cover of every map. */
export const askedOfLayout = (layout: VsmLayout): VsmAsked => ({
  poolPages: layout.poolPages,
  occlusion: layout.occlusion,
  dynamicHzb: layout.hzbLayers > 1,
  cacheEnabled: layout.cacheEnabled,
  localCover: layout.coverLocal,
})

/** The set's options for `fullMapCapacity` maps and `sunMaps` clipmap maps (`sunMapsFor`), for what
 *  is `asked` of it (`vsmAsked`): the receiver cover holds the suns' clipmap levels, every map's
 *  with `localCover`. `mapSlotsPast` the map slots past the blocks the lights asked, none for the
 *  default. */
export const engineVsmOptions = (
  fullMapCapacity: number,
  sunMaps: number,
  asked: VsmAsked,
  mapSlotsPast?: number,
): VsmResourceOptions => ({
  fullMapCapacity,
  sunMapCapacity: sunMaps + 1,
  ...asked,
  mapSlotsPast,
})

/** The map slots past the blocks that a set of `layout` holds. */
export const mapSlotsPastOf = (layout: VsmLayout) => layout.mapSlots - layout.fullMapCapacity

/** The clipmap maps the receiver cover of `options` holds (`engineVsmOptions`). */
export const sunMapsOf = (options: VsmResourceOptions) => (options.sunMapCapacity ?? 1) - 1
