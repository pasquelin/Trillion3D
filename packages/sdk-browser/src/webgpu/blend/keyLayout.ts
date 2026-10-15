import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { doubleReadWgsl } from '../../../../math/src/wgsl/doubleRead.ts'
import { doubleWords, fieldLayout } from '../../gpu/core/fieldLayout.ts'

/**
 * AN ITEM'S KEY RECORD (`keyRecords.ts`), which the order, the frustum verdict and the water
 * rectangle read on the GPU: six doubles — its world box, or its world origin without one —, then
 * its flags and its one-based water rank (zero for an item that does not transmit).
 */
const RECORD = fieldLayout('KeyRecord', [
  ['box', doubleWords(6)],
  ['flags', 'u32'],
  ['water', 'u32'],
] as const)
export const KEY_RECORD_WORDS = RECORD.words
export const KEY_WORD = RECORD.at
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
    KEY_WATER: KEY_WORD.water,
    KEY_HAS_BOX,
    KEY_DRAWN,
  })}
${doubleReadWgsl('keyedDouble', 'keyed')}`,
)
