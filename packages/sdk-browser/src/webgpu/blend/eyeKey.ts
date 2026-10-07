import type { BlendGpuItem } from './state.ts'

/** Key of an item: without a usable box, the world origin of its mesh stands in. */
export function eyeKey(item: BlendGpuItem, ex: number, ey: number, ez: number) {
  const box = item.bounds,
    m = item.matrix.elements
  const x = box ? (box[0] - ex + (box[3] - ex)) / 2 : m[12] - ex,
    y = box ? (box[1] - ey + (box[4] - ey)) / 2 : m[13] - ey,
    z = box ? (box[2] - ez + (box[5] - ez)) / 2 : m[14] - ez
  return x * x + y * y + z * z
}
