import { maxStretch } from '../../../../sdk-core/src/index.ts'
import { FRAME_VEC4, type PackedDag } from './types.ts'

/**
 * Indices of the linear part of a column-major world matrix, and the only indices `maxStretch`
 * reads (`projectionOracles.ts`). Translation — indices 12 to 14 — is not among them, nor is the
 * last row.
 */
const LINEAR = [0, 1, 2, 4, 5, 6, 8, 9, 10]

/** First per-primitive word of primitive `w` in the frame buffer, behind its six planes: the
 *  stretch, then the root (`+ 1`), the record shift (`+ 2`) and the never-culled mark (`+ 3`), as
 *  `primitiveFrameWords` lays them. */
export const primitiveWordAt = (w: number) => (w * FRAME_VEC4 + 6) * 4

/**
 * Object-to-view stretch of primitives whose linear part moved, recomputed for them only; returns
 * their count.
 *
 * The render frame follows the eye: at each camera step, all sixteen floats of each world matrix
 * are rewritten while only their translation changes. Stretch depends only on the nine linear
 * coefficients — `maxStretch` reads only those — so recomputing it for a moved origin would
 * yield the exact same float, then push the whole frame buffer again. Zero returned here means "no
 * stretch changed": the buffer has nothing to receive.
 */
export function refreshWorldStretch(
  previous: Float32Array,
  next: Float32Array,
  packed: Pick<PackedDag, 'worldCount' | 'worldStretch'>,
  frameData: Float32Array,
) {
  let count = 0
  for (let w = 0; w < packed.worldCount; w++)
    if (refreshStretchAt(previous, next, packed, frameData, w)) count++
  return count
}

/** Primitive `w`'s stretch recomputed when its linear part moved (`refreshWorldStretch`); whether
 *  it was. */
export function refreshStretchAt(
  previous: Float32Array,
  next: Float32Array,
  packed: Pick<PackedDag, 'worldStretch'>,
  frameData: Float32Array,
  w: number,
) {
  const base = w * 16
  let k = 0
  while (k < LINEAR.length && previous[base + LINEAR[k]] === next[base + LINEAR[k]]) k++
  if (k === LINEAR.length) return false
  const stretch = maxStretch(next.subarray(base, base + 16))
  packed.worldStretch[w] = stretch
  frameData[primitiveWordAt(w)] = stretch
  return true
}

/** Whether primitive `w`'s sixteen floats differ between `previous` and `next`. */
export function worldChangedAt(previous: Float32Array, next: Float32Array, w: number) {
  for (let j = w * 16; j < w * 16 + 16; j++) if (previous[j] !== next[j]) return true
  return false
}

/**
 * True where `next` differs from `previous` at any index: the scan `updateWorlds` runs before it
 * touches a buffer, so an image whose roots stand still uploads nothing. On a moving camera every
 * translation differs and the scan stops at the first root.
 */
export function worldsChanged(previous: Float32Array, next: Float32Array) {
  for (let j = 0; j < next.length; j++) if (previous[j] !== next[j]) return true
  return false
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
