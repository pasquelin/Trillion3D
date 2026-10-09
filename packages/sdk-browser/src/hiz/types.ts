import type { VisMaterial } from '../visibility/types.ts'
import type { MovedBox } from '../page/selection/types.ts'

export type HizPage = {
  min: number[]
  max: number[]
  /** Where a dynamic page's vertices are this frame (`rowBox`). */
  moved?: MovedBox
  url?: string
  clusterId?: string
  /** The surface it wears: one never culled (`neverCulled`) is never rejected. */
  material?: Pick<VisMaterial, 'sprite'>
}

/**
 * A Hi-Z pyramid laid out flat, as the CPU oracles read it: one `Float32Array` for every level,
 * one offset and size per level, level 0 the frame's depth and the last level 1×1.
 */
export type HizPyramid = {
  /** Every level's depths. */
  data: Float32Array
  /** Where each level starts. */
  offsets: Int32Array
  /** Each level's width. */
  widths: Int32Array
  /** Each level's height. */
  heights: Int32Array
  /** How many levels. */
  count: number
}
