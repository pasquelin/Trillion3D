import { hizBuildPyramid } from '../../../packages/sdk-core/src/hiz/oracles.fixture.ts'
import type { FlatHizPyramid } from '../../../packages/sdk-browser/src/hiz/types.ts'

/**
 * Visbuffer Hi-Z pyramid of the CPU oracles: the reference reduction (`hizBuildPyramid`, the
 * farthest of each 2×2 block down to 1×1) laid out flat, one buffer for every level. Depths are
 * single precision and the reduction a minimum, so the flat copy holds exactly the reference values.
 */
export function buildHizPyramid(
  depth: Float32Array,
  width: number,
  height: number,
): FlatHizPyramid {
  if (width < 1 || height < 1 || depth.length < width * height) throw new Error('HIZ_DEPTH_SIZE')
  const rows: number[][] = []
  for (let y = 0; y < height; y++) rows.push(Array.from(depth.subarray(y * width, (y + 1) * width)))
  const levels = hizBuildPyramid(rows)
  const count = levels.length
  const offsets = new Int32Array(count),
    widths = new Int32Array(count),
    heights = new Int32Array(count)
  let total = 0
  for (let level = 0; level < count; level++) {
    offsets[level] = total
    heights[level] = levels[level].length
    widths[level] = levels[level][0].length
    total += widths[level] * heights[level]
  }
  const data = new Float32Array(total)
  for (let level = 0; level < count; level++)
    for (let y = 0; y < heights[level]; y++)
      data.set(levels[level][y], offsets[level] + y * widths[level])
  return { data, offsets, widths, heights, count }
}
