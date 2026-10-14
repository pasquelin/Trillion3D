// The maps the frame's casting lights take (`engineVsm.ts`): a clipmap's levels a sun, six faces a
// point light, one a spot; the full maps a set is first made for, the mask's lights, the raster's
// views, and the set's options for them.
import { alignUp } from '../../../../../../math/src/scalar/integers.ts'
import type { VsmFrameLight } from '../../../../vsm/frameSetup.ts'
import { vsmShadowed } from '../../../../vsm/seenLights.ts'
import {
  VSM_MIPS,
  VSM_SUN_COARSEST_LEVEL,
  VSM_SUN_FINEST_LEVEL,
} from '../../../../vsm/constants.ts'
import type { VsmResourceOptions } from '../../../../vsm/layout.ts'

/** Directional clipmap levels a sun takes. */
const CLIPMAP_LEVELS = VSM_SUN_COARSEST_LEVEL - VSM_SUN_FINEST_LEVEL + 1
/** Full maps per page-table row: (`VSM_TABLE_ROW_WIDTH` / 2) / 128, a map being 128 pages wide. */
const TABLES_PER_ROW = 64
/** Room for `maps` full maps, rounded up to whole page-table rows (the last entry of the last row
 *  holds the single-page maps). */
export const wholeTableRows = (maps: number) => alignUp(maps + 1, TABLES_PER_ROW) - 1

/** The full maps one light takes when it casts: a clipmap's levels for a sun, six faces for a
 *  point, one for a spot. */
const mapsOf = (kind: VsmFrameLight['light']['kind']) =>
  kind === 'directional' ? CLIPMAP_LEVELS : kind === 'point' ? 6 : kind === 'spot' ? 1 : 0

/** Full maps a set is first made for: its suns' clipmap levels, with room for the unreferenced
 *  entries the cache keeps ten frames, rounded to whole page-table rows — one row at least, which
 *  holds a sun and six more maps with that room. A local light takes a full map only while its
 *  view asks finer than one page (`localLight.ts`), else a single-page slot, whose ids the tables
 *  reserve: the full maps a frame plans follow the lights near its eye, never those it sees, and
 *  the plan grows the tables to them in the same frame (`planVirtualShadowFrame`, `grow`). */
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

/** The raster's views the frame's casting lights take at most (`vsmRenderViews`): a view per
 *  clipmap level of one mip, a view per local map of every mip. */
export function renderViewBound(lights: readonly VsmFrameLight[]) {
  let views = 0,
    mips = 0
  for (const entry of lights) {
    if (!vsmShadowed(entry)) continue
    const { light } = entry,
      maps = mapsOf(light.kind)
    views += maps
    mips += light.kind === 'directional' ? maps : maps * VSM_MIPS
  }
  return { viewWords: 4 * views, viewMips: mips }
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
