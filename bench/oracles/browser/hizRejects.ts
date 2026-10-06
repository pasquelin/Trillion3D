import { hizRejectsFlat } from '../../../packages/sdk-browser/src/hiz/occlusion.ts'
import { HIZ_BOUNDS_VALUES } from '../../../packages/sdk-browser/src/hiz/corners.ts'
import type { HizPyramid } from '../../../packages/sdk-browser/src/hiz/types.ts'

/** One box as an object, the shape the oracles and the GPU comparisons write; the engine itself
 *  reads the flat layout (`HIZ_BOUNDS_VALUES`). */
export type HizBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  nearestDepth: number
  clipsNear: boolean
}

const boundsScratch = new Float64Array(HIZ_BOUNDS_VALUES)
/** The engine's verdict on one box given as an object, `hizRejectsFlat` on the flat layout the
 *  engine writes: what the oracles and the GPU comparisons ask, the engine itself never does. */
export function hizRejects(pyramid: HizPyramid, bounds: HizBounds, bias = 0) {
  boundsScratch[0] = bounds.minX
  boundsScratch[1] = bounds.minY
  boundsScratch[2] = bounds.maxX
  boundsScratch[3] = bounds.maxY
  boundsScratch[4] = bounds.nearestDepth
  boundsScratch[5] = bounds.clipsNear ? 1 : 0
  return hizRejectsFlat(pyramid, boundsScratch, 0, bias)
}
