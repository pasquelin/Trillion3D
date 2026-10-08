import { maxStretch } from '../../../../sdk-core/src/index.ts'
import { FRAME_VEC4, type PackedDag } from './types.ts'
import { sameLinearPart } from '../../../../math/src/matrix/matrixElements.ts'

/** First per-primitive word of primitive `w` in the frame buffer, behind its six planes: the
 *  stretch, then the root (`+ 1`), the record shift (`+ 2`) and the never-culled mark (`+ 3`), as
 *  `primitiveFrameWords` lays them. */
export const primitiveWordAt = (w: number) => (w * FRAME_VEC4 + 6) * 4

/**
 * Object-to-view stretch of the `count` primitives of `moved` whose linear part moved, recomputed
 * for them only and listed in `into`, increasing as `moved` is; returns their count.
 *
 * A pose that only moved keeps its linear part. Stretch depends only on the nine linear
 * coefficients — `maxStretch` reads only those — so recomputing it for a moved translation would
 * yield the exact same float, then push its frame row again. Zero returned here means "no stretch
 * changed": the buffer has nothing to receive.
 */
export function refreshMovedStretch(
  previous: Float32Array,
  next: Float32Array,
  packed: Pick<PackedDag, 'worldStretch'>,
  frameData: Float32Array,
  moved: ArrayLike<number>,
  count: number,
  into: Int32Array,
) {
  let stretched = 0
  for (let i = 0; i < count; i++)
    if (refreshStretchAt(previous, next, packed, frameData, moved[i])) into[stretched++] = moved[i]
  return stretched
}

/** Primitive `w`'s stretch recomputed when its linear part moved (`refreshMovedStretch`); whether
 *  it was. */
function refreshStretchAt(
  previous: Float32Array,
  next: Float32Array,
  packed: Pick<PackedDag, 'worldStretch'>,
  frameData: Float32Array,
  w: number,
) {
  const base = w * 16
  // `maxStretch` reads the linear part alone (`projectionOracles.ts`).
  if (sameLinearPart(previous, next, base, base)) return false
  const stretch = maxStretch(next.subarray(base, base + 16))
  packed.worldStretch[w] = stretch
  frameData[primitiveWordAt(w)] = stretch
  return true
}

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
 * Per-primitive frame words, behind the six planes of its first row: the stretch, the root the
 * descent starts from, the record shift that leads its pages to their shared records
 * (`layout.ts`), and the primitive's root mark (`PackedDag.mark`). Four words the
 * kernel reads without one more storage buffer bound to the stage.
 */
export function primitiveFrameWords(
  packed: Pick<PackedDag, 'worldCount' | 'worldStretch' | 'rootNodes' | 'recordShift'> &
    Partial<Pick<PackedDag, 'mark'>>,
) {
  const worldCount = Math.max(1, packed.worldCount)
  const frameData = new Float32Array(worldCount * FRAME_VEC4 * 4)
  for (let w = 0; w < packed.worldCount; w++) writePrimitiveWords(frameData, packed, w)
  return frameData
}

/** Primitive `w`'s four frame words (`primitiveFrameWords`), written into `frameData`. */
export function writePrimitiveWords(
  frameData: Float32Array,
  packed: Pick<PackedDag, 'worldStretch' | 'rootNodes' | 'recordShift'> &
    Partial<Pick<PackedDag, 'mark'>>,
  w: number,
) {
  const at = primitiveWordAt(w),
    frameInts = new Uint32Array(frameData.buffer, frameData.byteOffset, frameData.length)
  frameData[at] = packed.worldStretch[w]
  frameInts[at + 1] = packed.rootNodes[w]
  frameInts[at + 2] = packed.recordShift[w]
  frameInts[at + 3] = packed.mark?.[w] ?? 0
}
