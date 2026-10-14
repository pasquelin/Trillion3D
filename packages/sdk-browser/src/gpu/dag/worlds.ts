import { worldStretch } from '../../page/selection/rootWorld.ts'
import { FRAME_VEC4, type PackedDag } from './types.ts'
import { sameLinearPart } from '../../../../math/src/matrix/matrixElements.ts'
import { structuresOf } from './structureTable.ts'

/** First word of primitive `w` in the frame buffer, its row: the stretch, then the root (`+ 1`),
 *  the record shift (`+ 2`), the never-culled mark (`+ 3`), its first page (`+ 4`) — what its shared
 *  nodes' pages are counted from —, the open counts it holds of its own (`+ 5`, `heldOpen.ts`), its
 *  page count (`+ 6`) and its group structure's base (`+ 7`, `structureTable.ts`), as
 *  `primitiveFrameWords` lays them. */
export const primitiveWordAt = (w: number) => w * FRAME_VEC4 * 4
/** The frame words of a placement's first page and of the open counts it holds (`primitiveWordAt`). */
const PAGE_BASE_WORD = 4,
  PAGE_COUNT_WORD = 6
export const HELD_BY_WORD = 5,
  STRUCTURE_WORD = 7

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
 * Per-primitive frame words, behind the six planes of its first row: the stretch — the CPU's one
 * memo of it (`worldStretch`), which the GPU writes again from its doubles once the world moves
 * (`../../placement/rootBoxes.ts`) —, the root the descent starts from, the record shift that leads its pages to their shared records
 * (`layout.ts`), and the primitive's root mark (`PackedDag.mark`). Four words the
 * kernel reads without one more storage buffer bound to the stage.
 */
export function primitiveFrameWords(
  packed: Pick<PackedDag, 'worldCount' | 'worldSources' | 'rootNodes' | 'recordShift'> &
    Partial<Pick<PackedDag, 'mark' | 'cutLinks' | 'heldOpen' | 'structures'>>,
) {
  const worldCount = Math.max(1, packed.worldCount)
  const frameData = new Float32Array(worldCount * FRAME_VEC4 * 4)
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
  // A slot of the room a growth keeps holds no root yet: no stretch, as no world.
  const source = packed.worldSources[w]
  frameData[at] = source ? worldStretch(source) : 0
  frameInts[at + 1] = packed.rootNodes[w]
  frameInts[at + 2] = packed.recordShift[w]
  frameInts[at + 3] = packed.mark?.[w] ?? 0
  frameInts[at + PAGE_BASE_WORD] = packed.cutLinks?.[w]?.pageBase ?? 0
  frameInts[at + HELD_BY_WORD] = packed.heldOpen?.heldBy(w) ?? 0
  frameInts[at + PAGE_COUNT_WORD] = packed.cutLinks?.[w]?.pageCount ?? 0
  // The structure is placed at its primitive's first placement, in placement order.
  frameInts[at + STRUCTURE_WORD] = structuresOf(packed).baseOf(packed.cutLinks?.[w]?.structure)
}
