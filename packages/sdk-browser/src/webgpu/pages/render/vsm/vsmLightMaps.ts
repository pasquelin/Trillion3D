// The maps the frame's casting lights take (`engineVsm.ts`): a clipmap's levels a sun, six faces a
// point light, one a spot; the full maps a set is first made for, the mask's lights, the raster's
// views, and the set's options for them.
import { alignUp } from '../../../../../../math/src/scalar/integers.ts'
import type { VsmFrameLight } from '../../../../vsm/frameSetup.ts'
import { vsmShadowed } from '../../../../vsm/seenLights.ts'
import { VSM_TABLES_PER_ROW, type VsmResourceOptions } from '../../../../vsm/layout.ts'
import { vsmMapsOf, vsmRenderViewBound } from '../../../../vsm/mapViews.ts'

/** Directional clipmap levels a sun takes (`vsmMapsOf`). */
const CLIPMAP_LEVELS = vsmMapsOf('directional')
/** Room for `maps` page-table blocks, rounded up to whole page-table rows. */
export const wholeTableRows = (maps: number) => alignUp(maps, VSM_TABLES_PER_ROW)

/** Page-table blocks a set is first made for: its suns' clipmap levels, with room for the
 *  unreferenced entries the cache keeps ten frames, rounded to whole page-table rows — one row at
 *  least, which holds a sun and more maps with that room. A local light's table is sized by its
 *  finest mip (`tableBlocks.ts`): a far one takes one entry of a block, so the blocks a frame plans
 *  follow the lights near its eye, and the plan grows the tables to them in the same frame
 *  (`planVirtualShadowFrame`, `grow`). */
export function fullMapsFor(lights: readonly VsmFrameLight[]) {
  let maps = 0
  for (const entry of lights)
    if (vsmShadowed(entry) && entry.light.kind === 'directional') maps += CLIPMAP_LEVELS
  return wholeTableRows(2 * maps + 16)
}

/** The frame's lights it shadows (`vsmShadowed`): the mask takes a layer per four of them. */
export function castingCount(lights: readonly VsmFrameLight[]) {
  let count = 0
  for (const entry of lights) if (vsmShadowed(entry)) count++
  return count
}

/** The frame's casting lights (`vsmShadowed`), rewritten by each `renderViewBound`. */
const casting: VsmFrameLight['light'][] = []
/** The raster's views the frame's casting lights take at most (`vsmRenderViewBound`, the raster's
 *  own rule), before their maps are set up. */
export function renderViewBound(lights: readonly VsmFrameLight[]) {
  casting.length = 0
  for (const entry of lights) if (vsmShadowed(entry)) casting.push(entry.light)
  const { views, viewMips } = vsmRenderViewBound(casting)
  return { viewWords: 4 * views, viewMips }
}

export function directionalCount(lights: readonly VsmFrameLight[]) {
  let count = 0
  for (const entry of lights) if (vsmShadowed(entry) && entry.light.kind === 'directional') count++
  return Math.max(1, count)
}

/** The set's options for `fullMapCapacity` maps and `directional` suns, at `poolPages`:
 *  the receiver cover holds the suns' clipmap levels. */
export const engineVsmOptions = (
  fullMapCapacity: number,
  directional: number,
  poolPages?: number,
): VsmResourceOptions => ({
  fullMapCapacity,
  sunMapCapacity: CLIPMAP_LEVELS * directional + 1,
  poolPages,
})

/** The suns the receiver cover of `options` holds (`engineVsmOptions`). */
export const sunsOf = (options: VsmResourceOptions) =>
  ((options.sunMapCapacity ?? 1) - 1) / CLIPMAP_LEVELS
