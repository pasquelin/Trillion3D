import { boxCenterFrom } from '../../../../math/src/geometry/box.ts'
import { lengthSqVector3 } from '../../../../math/src/vector/vector.ts'
import type { BlendGpuItem } from './state.ts'

const offset = new Float64Array(3)

/** Key of an item: without a usable box, the world origin of its mesh stands in. */
export function eyeKey(item: BlendGpuItem, ex: number, ey: number, ez: number) {
  const box = item.bounds,
    m = item.matrix.elements
  if (box) boxCenterFrom(offset, 0, box, 0, ex, ey, ez)
  else {
    offset[0] = m[12] - ex
    offset[1] = m[13] - ey
    offset[2] = m[14] - ez
  }
  return lengthSqVector3(offset)
}
