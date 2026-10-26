import { BASE_SLOTS, CULL_BINS } from '../../visibility/bins/contract.ts'
import type { WebgpuPagesCore } from '../backend/runtime.ts'

/** The pipelines by face mode: both halves — the cut's main pass and its post pass — and every
 *  coplanar layer draw with them (`GpuBins`). */
const VIS_SLOTS = ['visPipelineBack', 'visPipelineNone', 'visPipelineFront'] as const

/** Pipeline of an indirect slot: its bin's face mode's, whatever its layer — a layer is its clusters'
 *  own depth units (`page.depthBias`). A cutout slot draws with it, an opaque one with its twin, a
 *  voxel one with its voxel twin (`drawVis`). */
export function visSlotPipeline(rt: WebgpuPagesCore, slot: number) {
  return rt.vis[VIS_SLOTS[(slot % BASE_SLOTS) % CULL_BINS]]
}
