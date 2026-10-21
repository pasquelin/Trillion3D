import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import { doubleReadFn } from '../../../math/src/wgsl/doubleRead.ts'
import { doubleWords, fieldLayout } from '../gpu/core/fieldLayout.ts'

/**
 * AN ITEM'S KEY RECORD (`keyRecords.ts`), which the order and the frustum verdict read on the GPU:
 * six doubles — its world box, or its world origin without one —, then its flags, its sort
 * priority, biased by `PRIORITY_BIAS` so that it compares as an unsigned word, the HLOD 0 cell its
 * row lies in — the HLOD cell whose actor it is a row of, `ACTOR_ROW` set — with the world
 * instance holding it, and the slot of its cell file's word
 * (`NO_INDEX` for none): the verdict reads those words as the descent does
 * (`verdict/verdictWgsl.ts`), so no switch rewrites a record — a file's slot taken or given back
 * does.
 */
const RECORD = fieldLayout('KeyRecord', [
  ['box', doubleWords(6)],
  ['flags', 'u32'],
  ['priority', 'u32'],
  ['cell', 'u32'],
  ['instance', 'u32'],
  ['file', 'u32'],
] as const)
export const KEY_RECORD_WORDS = RECORD.words
export const KEY_WORD = RECORD.at
/** The six doubles are a world box: the frustum can reject the item, its key is the box's centre. */
export const KEY_HAS_BOX = 1
/** The item is drawn as the host sees it: its source node shown and its row not parked
 *  (`notDrawn`); its row's cell file and HLOD 0 cell are the GPU's to read (`KEY_WORD.file`,
 *  `KEY_WORD.cell`). */
export const KEY_DRAWN = 2
/** The item transmits: its box is judged for the distortion (`VERDICT_IN_VIEW`). */
export const KEY_TRANSMITS = 4
/** The item's row lies in a cell file: drawn by its file's word once the cut gives the file a slot
 *  (`KEY_WORD.file`), by its HLOD 0 cell's alone till then. */
export const KEY_FILED = 8
/** Added to a priority — a material's translucent sort priority, a signed 16-bit value — to store
 *  it as an unsigned word (`priority + 32768`), so the key's unsigned order keeps its sign. */
export const PRIORITY_BIAS = 0x8000

/** The record's layout and its doubles' read, as each kernel that binds `keyed` names them. */
export const KEYED_WGSL = wgslBlock(
  'KEYED_WGSL',
  [],
  `${wgslConsts({
    KEY_RECORD_WORDS,
    KEY_FLAGS: KEY_WORD.flags,
    KEY_PRIORITY: KEY_WORD.priority,
    KEY_CELL: KEY_WORD.cell,
    KEY_INSTANCE: KEY_WORD.instance,
    KEY_FILE: KEY_WORD.file,
    KEY_HAS_BOX,
    KEY_DRAWN,
    KEY_TRANSMITS,
    KEY_FILED,
  })}
${doubleReadFn('keyedDouble', 'keyed')}`,
)
