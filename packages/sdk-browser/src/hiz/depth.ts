import { hizBuildFlat } from '../../../sdk-core/src/index.ts'
import type { HizPyramid } from './types.ts'

/**
 * Visbuffer Hi-Z pyramid: far background, reduce toward farthest. The pyramid is flat: one buffer
 * for every level. `into` reuses it from frame to frame — same size, same offsets, no row
 * reallocated; otherwise a new pyramid is placed.
 */
export function buildHizPyramid(
  depth: Float32Array,
  width: number,
  height: number,
  into?: HizPyramid,
): HizPyramid {
  if (width < 1 || height < 1 || depth.length < width * height) throw new Error('HIZ_DEPTH_SIZE')
  return hizBuildFlat(depth, width, height, into)
}
