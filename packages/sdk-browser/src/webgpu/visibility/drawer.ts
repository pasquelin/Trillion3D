import { visSlotPipeline } from '../pages/prepare/pipelineFor.ts'
import {
  BASE_SLOTS,
  BIN_KIND,
  BIN_NONE,
  CULL_BINS,
  HALF_SLOTS,
  type BinKind,
} from '../../gpu/draw/contract.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { askVoxelTwin, twinOf, VIS_DEPTH, VIS_TARGETS, voxelTwinCount } from './pipelines.ts'
import { visGroupFor } from './visGroup.ts'
import type { RecordBundle, RenderCommands } from '../../gpu/core/renderBundles.ts'
import { prepared } from '../pages/state/prepared.ts'

/** The kind of rows bin `bin` of a half holds (`BIN_KIND`). */
const binKind = (bin: number) => Math.floor(bin / CULL_BINS) as BinKind

/** `pipeline` for a slot of rows of kind `kind`: its twin of that kind (`twinOf`) — the opaque one
 *  neither reads the page nor discards, `maskKeep` keeping every pixel of such a row; the voxel one
 *  traces the bricks —, or itself. */
const drawnWith = (pipeline: GPURenderPipeline, kind: BinKind) => twinOf(pipeline, kind) ?? pipeline

/** Whether bin `bin` of a half is walked: a voxel bin only while the table holds a voxel row, and
 *  never the two-sided one, which no voxel row takes (`rowSide`). */
const walked = (bin: number, voxels: boolean) =>
  binKind(bin) !== BIN_KIND.VOXEL || (voxels && bin % CULL_BINS !== BIN_NONE)

/** The slot draws' bundle layout: the visibility targets — the identifiers and the pyramid's
 *  level 0 — and depth (`passes.ts`). */
const SLOT_BUNDLE = {
  label: 'Trillion3D visibility slots',
  colorFormats: VIS_TARGETS.map((target) => target.format),
  depthStencilFormat: VIS_DEPTH.format,
}

/** What a half's walk drew, and whether every slot with a pipeline found its group. */
type SlotWalk = { draws: number; complete: boolean }

/** What a recording walks besides its key's decisions: the runtime, its device and the half. Set
 *  before each `execute`, read only by a recording: nothing allocated on a replayed frame. */
const walking = {
  rt: undefined as WebgpuPagesRuntime | undefined,
  device: undefined as GPUDevice | undefined,
  rest: false,
}

/**
 * Walks a half's slots (`rest` false the occluder half) into `encoder`: each slot with a pipeline
 * is set its pipeline — `pipelineOf` of its raster pipeline and the kind of rows its bin holds,
 * or the one its caller set for every slot —, binds its group and draws its indirect command; a
 * slot with a pipeline whose group cannot be made yet leaves the walk incomplete. A coplanar layer
 * is one more set of slots, drawn in the same order: its clusters carry their pipeline's depth bias,
 * those of layer 0 do not change. The raster's halves (`recordSlots`) and the x-ray pass
 * (`./xray.ts`) walk them so.
 */
export function walkSlots(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: RenderCommands,
  rest: boolean,
  pipelineOf?: (pipeline: GPURenderPipeline, kind: BinKind) => GPURenderPipeline,
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
      if (!walked(bin, voxels && layer === 0)) continue
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

/** Records a half's slot draws (`walking`, `walkSlots`); an incomplete walk is walked again next
 *  frame. */
const recordSlots: RecordBundle = (encoder): SlotWalk =>
  walkSlots(walking.rt!, walking.device!, encoder, walking.rest, drawnWith)

/**
 * Draws the occluder half (`rest` false) or the tested half, by indirect commands, executed as the
 * half's render bundle (`rt.vis.visBundles`). Both draw with the same pipelines: the tested half's
 * compaction left its rejected rows out (`GpuDraw.encodeTested`), so no vertex stage reads a
 * verdict.
 *
 * Each half draws its opaque slots, then its cutout ones (bins from `CULL_BINS`), then its voxel
 * ones (bins from twice `CULL_BINS`, walked only while the table holds a voxel row), its opaque
 * rows with the twin: their depth is down, early rejected, before a cutout fragment reads its page;
 * a voxel fragment, which writes its depth, meets the depth every other one wrote. The call count
 * depends only on the slot count and on whether a voxel row is held,
 * never on the rows or on what the partition decided: each slot's instance count lives in the
 * indirect command the GPU wrote, and a slot nothing fills draws zero instances.
 *
 * The key holds what decides the walk, not the walk, nor what is the same for every key of a
 * half's bundles (the runtime, its device, the half): the indirect buffer, the
 * layer count, the group layout, the slot groups' revision (`visGroupsRevision`, moved
 * where they are voided), the layer pipelines and layer 0's six, whether a voxel row is held and
 * the voxel twins made — a held frame compares these and replays; the walk runs only when one
 * moved. Each call counts on `rt.run.gpuDrawCalls`.
 */
export function drawVis(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pass: GPURenderPassEncoder,
  rest: boolean,
) {
  const { vis } = rt
  const bundles = vis.visBundles[rest ? 1 : 0],
    key = bundles.keyed(SLOT_BUNDLE)
  key.push(prepared(vis, 'gpuDraw').indirectBuffer, vis.drawLayerSlots)
  key.push(vis.visBindGroupLayout, vis.visGroupsRevision)
  key.push(vis.visLayerPipelines, vis.visLayerPipelines.length)
  key.push(vis.visPipelineBack, vis.visPipelineNone, vis.visPipelineFront)
  key.push(rt.layout.itemWordsHold.voxelRows > 0, voxelTwinCount())
  walking.rt = rt
  walking.device = device
  walking.rest = rest
  const walk = bundles.execute(pass, device, recordSlots) as SlotWalk
  walking.rt = walking.device = undefined
  if (!walk.complete) bundles.forgetLatest()
  rt.run.gpuDrawCalls += walk.draws
}
