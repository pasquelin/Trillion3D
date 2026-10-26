import type { BinKind } from '../bins/contract.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { twinOf, VIS_ID_TARGET, voxelTwinCount } from './pipelines.ts'
import { DEPTH_FORMAT } from '../../scene/targetFormats.ts'
import type { RecordBundle } from '../../gpu/core/renderBundles.ts'
import { prepared } from '../../frame/backend/state/prepared.ts'
import { voxelsPresent, walkSlots, type SlotWalk } from './slotWalk.ts'

/** `pipeline` for a slot of rows of kind `kind`: its twin of that kind (`twinOf`) — the opaque one
 *  neither reads the page nor cuts, `maskKeep` keeping every pixel of such a row; the voxel one
 *  traces the bricks —, or itself. */
const drawnWith = (pipeline: GPURenderPipeline, kind: BinKind) => twinOf(pipeline, kind) ?? pipeline

/** The slot draws' bundle layout on a device with the 64-bit atomic maximum: the visibility raster's
 *  attachment, depth held read-only — its fragments write the visibility buffer (`VIS_DEPTH`). */
const SLOT_BUNDLE_WIDE: GPURenderBundleEncoderDescriptor = {
  label: 'Trillion3D visibility slots',
  colorFormats: [],
  depthStencilFormat: DEPTH_FORMAT,
  depthReadOnly: true,
  stencilReadOnly: true,
}
/** The same on a device without it: the identifiers' colour target and the scene's depth, written
 *  (`VIS_DEPTH_TESTED`, `VIS_ID_TARGET`). */
const SLOT_BUNDLE_SPLIT: GPURenderBundleEncoderDescriptor = {
  label: 'Trillion3D visibility slots',
  colorFormats: [VIS_ID_TARGET.format],
  depthStencilFormat: DEPTH_FORMAT,
}

/** What a recording walks besides its key's decisions: the runtime, its device and the half. Set
 *  before each `execute`, read only by a recording: nothing allocated on a replayed frame. */
const walking = {
  rt: undefined as WebgpuPagesRuntime | undefined,
  device: undefined as GPUDevice | undefined,
  rest: false,
}

/** Records a half's slot draws (`walking`, `walkSlots`) over the visibility buffer's group, where
 *  the fragments write one; an incomplete walk is walked again next frame. */
const recordSlots: RecordBundle = (encoder): SlotWalk => {
  const group = walking.rt!.vis.gpuRaster!.hardwareGroup
  if (group) encoder.setBindGroup(1, group)
  return walkSlots(walking.rt!, walking.device!, encoder, walking.rest, drawnWith)
}

/**
 * Draws the main pass's half (`rest` false) or the post pass's, by indirect commands, executed as
 * the half's render bundle (`rt.vis.visBundles`). Both halves draw with the same pipelines: each
 * half's bins sorted the clusters its pass drew into the slots (`GpuBins.encode`), so no vertex
 * stage reads a verdict.
 *
 * Each half draws its opaque slots, then its cutout ones (bins from `CULL_BINS`), then its voxel
 * ones (bins from twice `CULL_BINS`, walked only while the scene holds a voxel cluster), its opaque
 * clusters with the twin that never reads its page. The call count depends only on the slot count
 * and on whether a voxel cluster is held, never on the clusters or on what the cut decided: each
 * slot's instance count lives in the indirect command the GPU wrote, and a slot nothing fills
 * draws zero instances.
 *
 * The key holds what decides the walk, not the walk, nor what is the same for every key of a
 * half's bundles (the runtime, its device, the half): the indirect buffer, the layer
 * count, the group layout, the slot groups' revision (`visGroupsRevision`, moved where they are
 * voided), the visibility buffer's group, the six pipelines, whether a voxel cluster is held and the
 * voxel twins made — a held frame compares these and replays; the walk runs only when one moved.
 * Each call counts on `rt.run.gpuDrawCalls`.
 */
export function drawVis(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pass: GPURenderPassEncoder,
  rest: boolean,
) {
  const { vis } = rt
  const raster = vis.gpuRaster!
  const bundles = vis.visBundles[rest ? 1 : 0],
    key = bundles.keyed(raster.wide ? SLOT_BUNDLE_WIDE : SLOT_BUNDLE_SPLIT)
  key.push(prepared(vis, 'gpuBins').indirectBuffer, vis.drawLayerSlots)
  key.push(vis.visBindGroupLayout, vis.visGroupsRevision, raster.hardwareGroup)
  key.push(vis.visPipelineBack, vis.visPipelineNone, vis.visPipelineFront)
  key.push(voxelsPresent(rt), voxelTwinCount())
  walking.rt = rt
  walking.device = device
  walking.rest = rest
  const walk = bundles.execute(pass, device, recordSlots) as SlotWalk
  walking.rt = walking.device = undefined
  if (!walk.complete) bundles.forgetLatest()
  rt.run.gpuDrawCalls += walk.draws
}
