import type { PageRec } from '../../../page/selection/selection.ts'
import {
  BASE_SLOTS,
  BIN_BACK,
  BIN_FRONT,
  BIN_NONE,
  CULL_BINS,
  HALF_SLOTS,
} from '../../../gpu/draw/draw.ts'
import { visLayerPipelineIndex } from '../../visibility/pipelines.ts'
import { surfaceSide } from '../../../page/surface.ts'
import { windingCw } from '../render/winding.ts'
import type { WebgpuPagesCore } from '../runtime.ts'

/** The layout's selection roots, ranked by `rootOfPacked` (#1235). */
type Roots = Parameters<typeof windingCw>[0]

/** Layer 0's pipelines by half and face mode: the three untested ones, then their Hi-Z-tested
 *  twins. */
const VIS_SLOTS = [
  'visPipelineBack',
  'visPipelineNone',
  'visPipelineFront',
  'visHizRestBack',
  'visHizRestNone',
  'visHizRestFront',
] as const

/** Pipeline of an indirect slot: layer 0 keeps its own, each later layer has the same states plus
 *  its depth bias. A slot's face rank is its bin's face mode: a cutout slot draws with its face
 *  mode's pipeline, an opaque one with that pipeline's twin (`drawVis`). */
export function visSlotPipeline(rt: WebgpuPagesCore, slot: number) {
  const { vis } = rt
  const layer = Math.floor(slot / BASE_SLOTS),
    within = slot % BASE_SLOTS,
    rest = within >= HALF_SLOTS,
    cull = within % CULL_BINS
  if (layer === 0) return vis[VIS_SLOTS[(rest ? CULL_BINS : 0) + cull]]
  return vis.visLayerPipelines[visLayerPipelineIndex(layer, rest, cull)]
}

export const visBin = (rec: PageRec, rootRank: number, roots: Roots): 0 | 1 | 2 => {
  const side = surfaceSide(rec.material)
  if (side === 'double') return BIN_NONE
  // Indirect pipelines share ccw front faces; a reflection swaps which side
  // must be culled instead of requiring three more draw slots.
  return (side === 'back') !== windingCw(roots, rootRank) ? BIN_FRONT : BIN_BACK
}
