import type { PageRec } from '../../geometry/selection/types.ts'
import { rowSide } from '../../geometry/rows/surfaceRow.ts'
import {
  BASE_SLOTS,
  BIN_BACK,
  BIN_FRONT,
  BIN_NONE,
  CULL_BINS,
} from '../../visibility/draw/contract.ts'
import { windingCw } from '../render/winding.ts'
import type { WebgpuPagesCore } from '../backend/runtime.ts'

/** The layout's selection roots, ranked by the layout's index (`rootOfPacked`). */
type Roots = Parameters<typeof windingCw>[0]

/** The pipelines by face mode: both halves — the cut's main pass and its post pass — and every
 *  coplanar layer draw with them (`GpuDraw.encode`, `GpuDraw.encodePost`). */
const VIS_SLOTS = ['visPipelineBack', 'visPipelineNone', 'visPipelineFront'] as const

/** Pipeline of an indirect slot: its bin's face mode's, whatever its layer — a layer is its rows'
 *  own depth units (`page.depthBias`). A cutout slot draws with it, an opaque one with its twin, a
 *  voxel one with its voxel twin (`drawVis`). */
export function visSlotPipeline(rt: WebgpuPagesCore, slot: number) {
  return rt.vis[VIS_SLOTS[(slot % BASE_SLOTS) % CULL_BINS]]
}

export const visBin = (rec: PageRec, rootRank: number, roots: Roots): 0 | 1 | 2 => {
  const side = rowSide(rec)
  if (side === 'double') return BIN_NONE
  // Indirect pipelines share ccw front faces; a mirrored transform swaps which side
  // must be culled instead of requiring three more draw slots.
  return (side === 'back') !== windingCw(roots, rootRank) ? BIN_FRONT : BIN_BACK
}
