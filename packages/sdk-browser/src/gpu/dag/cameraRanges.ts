import { storageBufferCap } from '../../residency/pools.ts'
import { FRAME_VEC4, PRIMITIVE_VEC4 } from './types.ts'

/** Bytes one primitive holds in a camera cut's `frames`: the host's row, then what `dagPrepare`
 *  derives (`shader/primitiveWgsl.ts`), which the host never writes. */
export const PRIMITIVE_BYTES = (FRAME_VEC4 + PRIMITIVE_VEC4) * 16

/**
 * THE RANGES A CAMERA CUT'S `frames` IS SPLIT IN on this device. Each primitive holds
 * `PRIMITIVE_BYTES`, and one storage buffer holds and binds at most `storageBufferCap` bytes: past
 * it, one table could be neither created nor bound, and the scene would not draw. So the table is
 * cut into ranges of as many primitives as one buffer holds, each its own buffer and bind group —
 * its `worlds` too, a sixth of its bytes, so the matrices never outgrow a binding either —,
 * and the kernels that read a primitive's words run once per range, each on the primitives of its
 * range (`encode.ts`). A scene the device holds whole is one range: the layout, the kernels
 * (`SPLIT`, `shader/viewsWgsl.ts`) and the dispatches of before.
 */
export function cameraFrameRanges(
  limits: Parameters<typeof storageBufferCap>[0],
  worldCount: number,
) {
  const per = Math.max(1, Math.floor(storageBufferCap(limits) / PRIMITIVE_BYTES))
  const ranges: { first: number; count: number }[] = []
  for (let first = 0; first < worldCount; first += per)
    ranges.push({ first, count: Math.min(per, worldCount - first) })
  return ranges
}
