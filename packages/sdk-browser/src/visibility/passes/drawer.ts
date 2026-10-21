import { visSlotPipeline } from '../../frame/prepare/pipelineFor.ts'
import {
  BASE_SLOTS,
  BIN_KIND,
  BIN_NONE,
  CULL_BINS,
  HALF_SLOTS,
  type BinKind,
} from '../draw/contract.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { askVoxelTwin, twinOf, VIS_DEPTH, voxelTwinCount } from './pipelines.ts'
import { visGroupFor } from './visGroup.ts'
import type { RecordBundle, RenderCommands } from '../../gpu/core/renderBundles.ts'
import { prepared } from '../../frame/backend/state/prepared.ts'

/** The kind of rows bin `bin` of a half holds (`BIN_KIND`). */
const binKind = (bin: number) => Math.floor(bin / CULL_BINS) as BinKind

/** `pipeline` for a slot of rows of kind `kind` in the write's phase (`walking.ids`): its twin of
 *  that kind and phase (`twinOf`) — the opaque one neither reads the page nor cuts, `maskKeep`
 *  keeping every pixel of such a row; the voxel one traces the bricks —, or itself. */
const drawnWith = (pipeline: GPURenderPipeline, kind: BinKind) =>
  twinOf(pipeline, kind, walking.ids) ?? pipeline

/** Whether bin `bin` of a half is walked: a voxel bin only while the table holds a voxel row, and
 *  never the two-sided one, which no voxel row takes (`rowSide`); a software bin only by a walk
 *  that shows every triangle the cut submitted (`software`, the x-ray view's): the hardware raster
 *  draws none of its rows. */
const walked = (bin: number, voxels: boolean, software: boolean) => {
  const kind = binKind(bin)
  if (kind === BIN_KIND.SOFTWARE) return software
  return kind !== BIN_KIND.VOXEL || (voxels && bin % CULL_BINS !== BIN_NONE)
}

/** The slot draws' bundle layout: the visibility raster's attachment, depth held read-only — its
 *  fragments write the visibility buffer (`VIS_DEPTH`). */
const SLOT_BUNDLE: GPURenderBundleEncoderDescriptor = {
  label: 'Trillion3D visibility slots',
  colorFormats: [],
  depthStencilFormat: VIS_DEPTH.format,
  depthReadOnly: true,
  stencilReadOnly: true,
}

/** What a half's walk drew, and whether every slot with a pipeline found its group. */
type SlotWalk = { draws: number; complete: boolean }

/** What a recording walks besides its key's decisions: the runtime, its device, the half and the
 *  write's phase. Set before each `execute`, read only by a recording: nothing allocated on a
 *  replayed frame. */
const walking = {
  rt: undefined as WebgpuPagesRuntime | undefined,
  device: undefined as GPUDevice | undefined,
  rest: false,
  ids: false,
}

/**
 * Walks a half's slots (`rest` false the main pass's half, true the post pass's) into `encoder`:
 * each slot with a pipeline
 * is set its pipeline — `pipelineOf` of its raster pipeline and the kind of rows its bin holds,
 * or the one its caller set for every slot —, binds its group and draws its indirect command; a
 * slot with a pipeline whose group cannot be made yet leaves the walk incomplete. A coplanar layer
 * is one more set of slots, drawn in the same order with the same pipelines: its clusters carry
 * their layer in their row (`page.depthBias`). The raster's halves (`recordSlots`) and the x-ray
 * pass (`./xray.ts`, `software` true: the software raster's rows too) walk them so.
 */
export function walkSlots(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: RenderCommands,
  rest: boolean,
  pipelineOf?: (pipeline: GPURenderPipeline, kind: BinKind) => GPURenderPipeline,
  software = false,
): SlotWalk {
  const { vis } = rt,
    indirect = prepared(vis, 'gpuDraw').indirectBuffer
  const walk = { draws: 0, complete: true }
  // No layout: no slot binds this frame, the key holding it.
  if (!vis.visBindGroupLayout) return walk
  // A voxel row draws on layer 0 alone (`itemWords.ts`).
  const voxels = rt.layout.itemWordsHold.voxelRows > 0
  for (let layer = 0; layer < vis.drawLayerSlots; layer++) {
    const start = layer * BASE_SLOTS + (rest ? HALF_SLOTS : 0)
    for (let bin = 0; bin < HALF_SLOTS; bin++) {
      if (!walked(bin, voxels && layer === 0, software)) continue
      const s = start + bin,
        pipeline = visSlotPipeline(rt, s)
      if (!pipeline) continue
      // A voxel slot draws once its twin, asked now, landed: never its boxes as triangles.
      if (pipelineOf && binKind(bin) === BIN_KIND.VOXEL && !askVoxelTwin(pipeline)) continue
      const group = visGroupFor(rt, device, s)
      if (!group) {
        walk.complete = false
        continue
      }
      if (pipelineOf) encoder.setPipeline(pipelineOf(pipeline, binKind(bin)))
      encoder.setBindGroup(0, group)
      encoder.drawIndirect(indirect, s * 16)
      walk.draws++
    }
  }
  return walk
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

/**
 * The hardware raster's pass `label`: the halves `halves` (`rest` false the main pass's) drawn
 * in the phase `ids` of the visibility write, over the depth target held read-only — the pass's
 * one attachment; the fragments write the visibility buffer alone.
 */
export function encodeHardwareRaster(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  label: string,
  halves: readonly boolean[],
  ids: boolean,
) {
  const { gpu } = rt,
    [width, height] = gpu.targetSize
  const pass = encoder.beginRenderPass({
    label,
    colorAttachments: [],
    depthStencilAttachment: { view: gpu.depthView!, depthReadOnly: true },
  })
  pass.setViewport(0, 0, width, height, 0, 1)
  for (const rest of halves) drawVis(rt, device, pass, rest, ids)
  pass.end()
}
