import { mipLevelCountFor, levelSize } from '../../texture/tiles.ts'

/** Allocation of native mip rectangles padded in the distinct images’ array layers; no source is resized. */
export function physicalMapLayout(sizes: readonly (readonly [number, number])[], limit: number) {
  const width = Math.max(1, ...sizes.map((size) => size[0]))
  const height = Math.max(1, ...sizes.map((size) => size[1]))
  if (width > limit || height > limit) throw new Error('PHYSICAL_MAP_DEVICE_LIMIT')
  const layers = Math.max(1, sizes.length)
  const levels = mipLevelCountFor(width, height)
  let bytes = 0
  for (let level = 0; level < levels; level++) {
    const [w, h] = levelSize(width, height, level)
    bytes += w * h * 4 * layers
  }
  return { width, height, levels, layers, bytes }
}
