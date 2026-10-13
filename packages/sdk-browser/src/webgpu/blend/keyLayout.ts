import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'

/**
 * AN ITEM'S KEY RECORD (`keyRecords.ts`), which the order, the frustum verdict and the water
 * rectangle read on the GPU: six doubles — its world box, or its world origin without one —, then
 * its flags, its own rank (`NO_INDEX` for an item the GPU keys itself) and its one-based water rank
 * (zero for an item that does not transmit).
 */
export const KEY_RECORD_WORDS = 16
export const KEY_WORD = { flags: 12, own: 13, water: 14 } as const
/** The six doubles are a world box: the frustum can reject the item, its key is the box's centre. */
export const KEY_HAS_BOX = 1
/** The item is drawn: its source node shown and its row not parked (`notDrawn`). */
export const KEY_DRAWN = 2

/** The record's layout and its doubles' read, as each kernel that binds `keyed` names them. */
export const KEYED_WGSL = wgslBlock(
  'KEYED_WGSL',
  [],
  `${wgslConsts({
    KEY_RECORD_WORDS,
    KEY_FLAGS: KEY_WORD.flags,
    KEY_OWN: KEY_WORD.own,
    KEY_WATER: KEY_WORD.water,
    KEY_HAS_BOX,
    KEY_DRAWN,
  })}
fn keyedDouble(at:u32)->vec2u{return vec2u(keyed[at+1u],keyed[at]);}`,
)
