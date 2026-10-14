/**
 * THE ONE MAP FILTER OF A STALE: which previous-frame map a changed box stales. Both stales name a
 * map by one word — the CPU's boxes in their items' payload (`invalidationPhase.ts`), the rows' shadow
 * changes in the list of maps the CPU sends (`castInvalidation.ts`) —: its id, and whether it draws
 * its moving casters over a receiver cover, which a moving box skips. Both kernels read it through
 * `vsmStaleMap` (`staleBoxesWgsl.ts`, `castInvalidationWgsl.ts`).
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
