/**
 * THE ONE MAP FILTER OF THE STALE: which previous-frame map a changed box stales. The stale
 * (`castInvalidationWgsl.ts`) names each map by one word, from the list the CPU sends
 * (`vsmCastMaps`, `castInvalidation.ts`): its id, and whether it draws its moving casters over a
 * receiver cover, which a box of casters already moving skips — the rows' changes and the CPU's
 * boxes alike, through `vsmStaleMap`.
 */
import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import type { VsmLightCache } from './cacheManager.ts'

const MAP_ID = 0x7fffffff
const MAP_COVER = 0x80000000

/** The word of map `i` of `entry`: its id, and its cover bit. */
export const vsmMapWord = (entry: VsmLightCache, i: number) =>
  (entry.mapId + i) | (entry.useCover ? MAP_COVER : 0)

/** The map word `word` names for a box, `moving` or not: its id, or an id past every map when the
 *  box moves and the map draws its moving casters over a receiver cover. */
export const VSM_STALE_MAP_WGSL = wgslBlock(
  'VSM_STALE_MAP_WGSL',
  [],
  `${wgslConsts({ VSM_MAP_ID: MAP_ID, VSM_MAP_COVER: MAP_COVER })}
fn vsmStaleMap(word:u32,moving:bool)->u32{
 return select(word&VSM_MAP_ID,0xffffffffu,moving&&(word&VSM_MAP_COVER)!=0u);
}`,
)
