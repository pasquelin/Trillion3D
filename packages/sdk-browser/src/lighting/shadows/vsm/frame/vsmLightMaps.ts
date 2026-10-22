// The maps the frame's casting lights take (`engineVsm.ts`): a clipmap's levels a sun, six faces a
// point light, one a spot; the full maps a set is first made for, the mask's lights, the raster's
// views, and the set's options for them.
import { alignUp, floorLog2, nextPow2 } from '../../../../../../math/src/scalar/integers.ts'
import { clamp } from '../../../../../../math/src/scalar/reals.ts'
import { VSM_POOL_PAGES } from '../constants.ts'
import type { VsmFrameLight } from '../frameSetup.ts'
import { vsmShadowed } from '../seenLights.ts'
import { VSM_TABLES_PER_ROW, type VsmResourceOptions } from '../layout.ts'
import { VSM_DEFAULT_SUN_LEVELS, vsmRenderViewBound, type VsmViewLight } from '../mapViews.ts'
import { vsmViewPasses } from '../render/renderViewPasses.ts'
import { vsmViewPoolPages } from '../poolDraw.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { shadowSetting } from './vsmFarShadow.ts'

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

/** The frame's lights it shadows (`vsmShadowed`): the mask takes a layer per four of them. */
export function castingCount(lights: readonly VsmFrameLight[]) {
  let count = 0
  for (const entry of lights) if (vsmShadowed(entry)) count++
  return count
}

/** The frame's casting lights (`vsmShadowed`) as the raster's views count them, rewritten by each
 *  `renderViewBound`. */
const casting: VsmViewLight[] = []
/** The views the frame's casting lights take at most (`vsmRenderViewBound`, the raster's own
 *  rule), before their maps are set up: all of them in one pass, as the transmission's bin takes
 *  them, and the most one of the raster's view passes holds, in the `passes` of them
 *  (`vsmViewPasses`, `limit` the maps a pass lists), as the raster's lists are sized. */
export function renderViewBound(lights: readonly VsmFrameLight[], limit: number) {
  let count = 0
  for (const entry of lights)
    if (vsmShadowed(entry)) {
      const kind = entry.light.kind
      casting[count++] = { kind, count: kind === 'directional' ? sunLevelsOf(entry) : undefined }
    }
  casting.length = count
  const { views, viewMips } = vsmRenderViewBound(casting)
  const { list, mostMaps, mostMips } = vsmViewPasses(casting, limit)
  return {
    ...{ viewWords: 4 * (count + views), viewMips, lights: count },
    raster: { viewWords: 4 * (count + mostMaps), viewMips: mostMips, passes: list.length },
  }
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
 * The physical pages the views' sets ask: those their drawing buffers start at
 * (`vsmViewPoolPages`) — every view the world draws keeps its pages in the one pool —, or more
 * once a set's fill asked them (`vsmPoolDemand`, `vsmRegrow.ts`). A smaller view holds a smaller
 * pool, never one sized for another view; never past `VSM_POOL_PAGES`, the window a forward reader
 * binds, nor the setting's most pages (`shadowMaxPhysicalPages`, rounded down to a power of two),
 * and a power of two of pages.
 */
export function vsmPoolAsked(rt: WebgpuPagesRuntime) {
  const { lights, views } = rt
  let pages = vsmViewPoolPages(views.main.viewport[0], views.main.viewport[1])
  for (const { viewport } of views.persistent) pages += vsmViewPoolPages(viewport[0], viewport[1])
  const most = Math.min(VSM_POOL_PAGES, 2 ** floorLog2(shadowSetting(rt, 'shadowMaxPhysicalPages')))
  return clamp(nextPow2(pages), lights.vsmPoolDemand, most)
}

/** The set's options for `fullMapCapacity` maps and `sunMaps` clipmap maps (`sunMapsFor`), at
 *  `poolPages`: the receiver cover holds the suns' clipmap levels. */
export const engineVsmOptions = (
  fullMapCapacity: number,
  sunMaps: number,
  poolPages?: number,
): VsmResourceOptions => ({
  fullMapCapacity,
  sunMapCapacity: sunMaps + 1,
  poolPages,
})

/** The clipmap maps the receiver cover of `options` holds (`engineVsmOptions`). */
export const sunMapsOf = (options: VsmResourceOptions) => (options.sunMapCapacity ?? 1) - 1
