import type { PageRec } from '../../geometry/selection/types.ts'
import { rowSide } from '../../geometry/rows/surfaceRow.ts'
import {
  BASE_SLOTS,
  BIN_BACK,
  BIN_FRONT,
  BIN_NONE,
  CULL_BINS,
} from '../../visibility/draw/contract.ts'
import { visLayerPipelineIndex } from '../../visibility/passes/pipelines.ts'
import { windingCw } from '../render/winding.ts'
import type { WebgpuPagesCore } from '../backend/runtime.ts'

/** The layout's selection roots, ranked by the layout's index (`rootOfPacked`). */
type Roots = Parameters<typeof windingCw>[0]

/** Layer 0's pipelines by face mode: both halves draw with them, the tested half once the
 *  rejected rows left its compaction (`GpuDraw.encodeTested`). */
const VIS_SLOTS = ['visPipelineBack', 'visPipelineNone', 'visPipelineFront'] as const

/** Pipeline of an indirect slot: layer 0 keeps its own, each later layer has the same states plus
 *  its depth bias. A slot's face rank is its bin's face mode: a cutout slot draws with its face
 *  mode's pipeline, an opaque one with that pipeline's twin, a voxel one with its voxel twin
 *  (`drawVis`). */
export function visSlotPipeline(rt: WebgpuPagesCore, slot: number) {
  const { vis } = rt
  const layer = Math.floor(slot / BASE_SLOTS),
    cull = (slot % BASE_SLOTS) % CULL_BINS
  if (layer === 0) return vis[VIS_SLOTS[cull]]
  return vis.visLayerPipelines[visLayerPipelineIndex(layer, cull)]
}

export const visBin = (rec: PageRec, rootRank: number, roots: Roots): 0 | 1 | 2 => {
  const side = rowSide(rec)
  if (side === 'double') return BIN_NONE
  // Indirect pipelines share ccw front faces; a mirrored transform swaps which side
  // must be culled instead of requiring three more draw slots.
  return (side === 'back') !== windingCw(roots, rootRank) ? BIN_FRONT : BIN_BACK
}
