/**
 * THE RASTER'S VIEW PASSES (`renderPass.ts`): the frame's lights, taken in the order of their map ids,
 * grouped into the passes that each list and cull their own views over the caster rows. A view of
 * the raster is a map and a mip (`vsmRenderViews`), and the cull runs a thread row per
 * listed map on the z axis of one dispatch (`vsmRenderViews`, `vsmRenderCull`): a pass lists at
 * most as many maps as a dispatch has rows, `maxComputeWorkgroupsPerDimension` (65 535 on any
 * device) — a light holds one at least, so a pass holds at most that many lights too —; the ids the records pack
 * are `VSM_RECORD_MAP_ID_BITS` wide, which no frame passes (`layout.mapSlots`). The limit
 * counts maps, which bound the lights from above and are what the ids number. A light is
 * never split: when the next one would take the pass past what a dispatch carries, the pass closes
 * and a new one opens (`vsmViewPasses`). A frame whose lights fit has one pass, which is what the
 * raster always was; `multipass` off (the setting `shadowMultipassViews`) keeps every light in one
 * pass however many there are.
 */
import { ceilDiv } from '../../../../../../math/src/scalar/integers.ts'
import { groupWidth } from '../../../../gpu/dispatch/grid.ts'
import { VSM_RECORD_MAP_COUNT } from '../constants.ts'
import { vsmLightMaps, vsmLightMips, type VsmViewLight } from '../mapViews.ts'

/** The most passes a frame takes on any device: every map id a frame holds (`VSM_RECORD_MAP_COUNT`)
 *  in passes of the dispatch limit every device guarantees (`groupWidth` without limits). The
 *  timed passes are sized for it (`gpu/timing/vsmPasses.ts`). */
export const VSM_MAX_VIEW_PASSES = ceilDiv(VSM_RECORD_MAP_COUNT, groupWidth())

/** The maps a view pass takes at most on a device of `limits`: the rows of its dispatch — its
 *  lights are at most its maps —, none past the ids a map takes; unbounded when `multipass` is
 *  off. */
export const vsmViewsPerPass = (limits: Parameters<typeof groupWidth>[0], multipass: boolean) =>
  multipass ? Math.min(groupWidth(limits), VSM_RECORD_MAP_COUNT) : Infinity

/** One view pass: its maps are the ids `first` to `first + maps`, and `mips` the mip views the raster
 *  draws of them (what its lists are sized for). */
export interface VsmViewPass {
  first: number
  maps: number
  mips: number
}

/** The view passes of a frame (`vsmViewPasses`): the passes in order, the maps of all of them, and
 *  the most maps and mip views any one pass holds — what the lists of a pass are sized for, the
 *  lists being reused from one pass to the next. */
export interface VsmViewPasses {
  list: VsmViewPass[]
  maps: number
  mostMaps: number
  mostMips: number
}

/** The passes' records and the result handed out, rewritten in place by each frame, and the lights
 *  in the order of their ids. */
const result: VsmViewPasses = { list: [], maps: 0, mostMaps: 0, mostMips: 0 }
const byId: VsmViewLight[] = []
const firstIdOrder = (a: VsmViewLight, b: VsmViewLight) => a.firstId! - b.firstId!

/**
 * The view passes of `lights`, taken in the order of their ids (`allocateLightIds` gives them by class
 * of map, not in the order of the lights): a light joins the open pass, unless the pass holds maps
 * already and the light would take its ids past `limit` (`vsmViewsPerPass`) — then it opens the next.
 * Every light lies in exactly one pass, a pass is a run of consecutive ids (from the first light's
 * `firstId`, else from where the one before ended), and the maps of a pass are that run. The result
 * is rewritten in place by the next call.
 */
export function vsmViewPasses(lights: readonly VsmViewLight[], limit: number): VsmViewPasses {
  const { list } = result
  let used = 0,
    end = 0,
    pass: VsmViewPass | undefined
  result.maps = result.mostMaps = result.mostMips = 0
  // Lights set up have their ids; the lights of the bound, before any map is set up, have none and
  // follow one another.
  byId.length = 0
  let ordered = true
  for (const light of lights) {
    byId.push(light)
    ordered &&= light.firstId !== undefined
  }
  if (ordered) byId.sort(firstIdOrder)
  for (const light of byId) {
    const maps = vsmLightMaps(light),
      first = light.firstId ?? end
    if (!pass || (pass.maps > 0 && first + maps - pass.first > limit)) {
      pass = list[used++] ??= { first, maps: 0, mips: 0 }
      pass.first = first
      pass.maps = pass.mips = 0
    }
    end = first + maps
    pass.maps = end - pass.first
    pass.mips += vsmLightMips(light)
    result.maps += maps
    result.mostMaps = Math.max(result.mostMaps, pass.maps)
    result.mostMips = Math.max(result.mostMips, pass.mips)
  }
  list.length = used
  return result
}
