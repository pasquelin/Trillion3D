import type { BinKind } from '../draw/contract.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { twinOf, VIS_DEPTH, voxelTwinCount } from './pipelines.ts'
import type { RecordBundle } from '../../gpu/core/renderBundles.ts'
import { prepared } from '../../frame/backend/state/prepared.ts'
import { walkSlots, type SlotWalk } from './slotWalk.ts'

/** `pipeline` for a slot of rows of kind `kind` in the write's phase (`walking.ids`): its twin of
 *  that kind and phase (`twinOf`) — the opaque one neither reads the page nor cuts, `maskKeep`
 *  keeping every pixel of such a row; the voxel one traces the bricks —, or itself. */
const drawnWith = (pipeline: GPURenderPipeline, kind: BinKind) =>
  twinOf(pipeline, kind, walking.ids) ?? pipeline

/** The slot draws' bundle layout: the visibility raster's attachment, depth held read-only — its
 *  fragments write the visibility buffer (`VIS_DEPTH`). */
const SLOT_BUNDLE: GPURenderBundleEncoderDescriptor = {
  label: 'Trillion3D visibility slots',
  colorFormats: [],
  depthStencilFormat: VIS_DEPTH.format,
  depthReadOnly: true,
  stencilReadOnly: true,
}

/** What a recording walks besides its key's decisions: the runtime, its device, the half and the
 *  write's phase. Set before each `execute`, read only by a recording: nothing allocated on a
 *  replayed frame. */
const walking = {
  rt: undefined as WebgpuPagesRuntime | undefined,
  device: undefined as GPUDevice | undefined,
  rest: false,
  ids: false,
}

/** Records a half's slot draws (`walking`, `walkSlots`) over the visibility buffer's group; an
 *  incomplete walk is walked again next frame. */
const recordSlots: RecordBundle = (encoder): SlotWalk => {
  encoder.setBindGroup(1, walking.rt!.vis.gpuRaster!.hardwareGroup)
  return walkSlots(walking.rt!, walking.device!, encoder, walking.rest, drawnWith)
}

/**
 * Draws the main pass's half (`rest` false) or the post pass's in the phase `ids` of the visibility
 * write, by indirect commands, executed as the half's and the phase's render bundle
 * (`rt.vis.visBundles`). Both halves draw with the same pipelines: each half's compaction listed
 * the rows its pass's mask holds (`GpuDraw.encode`, `GpuDraw.encodePost`), so no vertex stage
 * reads a verdict.
 *
 * Each half draws its opaque slots, then its cutout ones (bins from `CULL_BINS`), then its voxel
 * ones (bins from twice `CULL_BINS`, walked only while the table holds a voxel row), its opaque
 * rows with the twin that never reads its page. The call count depends only on the slot count and
 * on whether a voxel row is held, never on the rows or on what the cut decided: each slot's
 * instance count lives in the indirect command the GPU wrote, and a slot nothing fills draws zero
 * instances.
 *
 * The key holds what decides the walk, not the walk, nor what is the same for every key of a
 * half's bundles (the runtime, its device, the half, the phase): the indirect buffer, the layer
 * count, the group layout, the slot groups' revision (`visGroupsRevision`, moved where they are
 * voided), the visibility buffer's group, the six pipelines, whether a voxel row is held and the
 * voxel twins made — a held frame compares these and replays; the walk runs only when one moved.
 * Each call counts on `rt.run.gpuDrawCalls`.
 */
export function drawVis(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pass: GPURenderPassEncoder,
  rest: boolean,
  ids: boolean,
) {
  const { vis } = rt
  const bundles = vis.visBundles[(rest ? 1 : 0) + (ids ? 2 : 0)],
    key = bundles.keyed(SLOT_BUNDLE)
  key.push(prepared(vis, 'gpuDraw').indirectBuffer, vis.drawLayerSlots)
  key.push(vis.visBindGroupLayout, vis.visGroupsRevision, vis.gpuRaster!.hardwareGroup)
  key.push(vis.visPipelineBack, vis.visPipelineNone, vis.visPipelineFront)
  key.push(rt.layout.itemWordsHold.voxelRows > 0, voxelTwinCount())
  walking.rt = rt
  walking.device = device
  walking.rest = rest
  walking.ids = ids
  const walk = bundles.execute(pass, device, recordSlots) as SlotWalk
  walking.rt = walking.device = undefined
  if (!walk.complete) bundles.forgetLatest()
  rt.run.gpuDrawCalls += walk.draws
}
