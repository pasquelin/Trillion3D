import type { PackedDag } from './types.ts'
import { FRAME_ROW_WORDS } from './types.ts'
import { sameLinearPart } from '../../../../math/src/matrix/matrixElements.ts'
import { structuresOf } from './structureTable.ts'
import {
  HELD_BY_WORD,
  MARK_WORD,
  PAGE_BASE_WORD,
  PAGE_COUNT_WORD,
  RECORD_SHIFT_WORD,
  ROOT_WORD,
  STRUCTURE_WORD,
} from './frameTable.ts'

/** First word of primitive `w`'s row in the host's frame words, its words as `frameTable.ts` names
 *  them. */
export const primitiveWordAt = (w: number) => w * FRAME_ROW_WORDS

/** Whether primitive `w`'s words a cut reads differ between `previous` and `next`: its linear part
 *  and word 15. Words 12 to 14 are no cut's — each makes the translation from the exact one at its
 *  eye (`shader/worldPoseWgsl.ts`), which goes up through the origins (`worldOrigins.ts`). */
export const worldChangedAt = (previous: Float32Array, next: Float32Array, w: number) => {
  const at = w * 16
  return !sameLinearPart(previous, next, at, at) || previous[at + 15] !== next[at + 15]
}

/** The primitives of the first `live` of `next` whose read words differ from `previous`'
 *  (`worldChangedAt`), increasing, into `into`; their count. The scan `updateWorlds` runs before it
 *  touches a buffer, so an image whose roots stand still — or only moved — uploads no world. */
export function changedWorlds(
  previous: Float32Array,
  next: Float32Array,
  into: Int32Array,
  live = next.length / 16,
) {
  let count = 0
  for (let w = 0; w < live; w++) if (worldChangedAt(previous, next, w)) into[count++] = w
  return count
}

/**
 * Per-primitive frame words (`frameTable.ts`): the root the
 * descent starts from, the record shift that leads its pages to their shared records (`layout.ts`),
 * the primitive's root mark (`PackedDag.mark`) and the words its pages and structure are found by.
 * Its stretch is no host word: the root boxes pass writes it (`../../placement/rootBoxes.ts`).
 */
export function primitiveFrameWords(
  packed: Pick<PackedDag, 'worldCount' | 'worldSources' | 'rootNodes' | 'recordShift'> &
    Partial<Pick<PackedDag, 'mark' | 'cutLinks' | 'heldOpen' | 'structures'>>,
) {
  const worldCount = Math.max(1, packed.worldCount)
  const frameData = new Float32Array(worldCount * FRAME_ROW_WORDS)
  for (let w = 0; w < packed.worldCount; w++) writePrimitiveWords(frameData, packed, w)
  return frameData
}

/** Primitive `w`'s frame words (`primitiveFrameWords`), written into `frameData`. */
export function writePrimitiveWords(
  frameData: Float32Array,
  packed: Pick<PackedDag, 'worldSources' | 'rootNodes' | 'recordShift'> &
    Partial<Pick<PackedDag, 'mark' | 'cutLinks' | 'heldOpen' | 'structures'>>,
  w: number,
) {
  const at = primitiveWordAt(w),
    frameInts = new Uint32Array(frameData.buffer, frameData.byteOffset, frameData.length)
  frameInts[at + ROOT_WORD] = packed.rootNodes[w]
  frameInts[at + RECORD_SHIFT_WORD] = packed.recordShift[w]
  frameInts[at + MARK_WORD] = packed.mark?.[w] ?? 0
  frameInts[at + PAGE_BASE_WORD] = packed.cutLinks?.[w]?.pageBase ?? 0
  frameInts[at + HELD_BY_WORD] = packed.heldOpen?.heldBy(w) ?? 0
  frameInts[at + PAGE_COUNT_WORD] = packed.cutLinks?.[w]?.pageCount ?? 0
  // The structure is placed at its primitive's first placement, in placement order.
  frameInts[at + STRUCTURE_WORD] = structuresOf(packed).baseOf(packed.cutLinks?.[w]?.structure)
}
