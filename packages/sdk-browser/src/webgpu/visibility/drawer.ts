import { visSlotPipeline } from '../pages/prepare/pipelineFor.ts'
import { BASE_SLOTS, CULL_BINS, HALF_SLOTS } from '../../gpu/draw/draw.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { opaqueTwin, VIS_DEPTH, VIS_TARGETS } from './pipelines.ts'
import { visGroupFor } from './visGroup.ts'
import type { RecordBundle } from '../../gpu/core/renderBundles.ts'
import { prepared } from '../pages/state/prepared.ts'

/** `pipeline`, or its twin that neither reads the page nor discards when the draw holds no cutout
 *  row — an opaque slot, a row that is none: `maskKeep` keeps every pixel of such a row, so both
 *  write the same words. */
const drawnWith = (pipeline: GPURenderPipeline, cuts: boolean) =>
  (!cuts && opaqueTwin(pipeline)) || pipeline

/** The slot draws' bundle layout: the visibility targets — the identifiers and the pyramid's
 *  level 0 — and depth (`passes.ts`). */
const SLOT_BUNDLE = {
  label: 'Trillion3D visibility slots',
  colorFormats: VIS_TARGETS.map((target) => target.format),
  depthStencilFormat: VIS_DEPTH.format,
}

/** The flags a half binds: the tested half reads the pyramid's verdicts, the occluders none. */
const halfFlags = (vis: WebgpuPagesRuntime['vis'], rest: boolean) =>
  rest ? prepared(vis, 'gpuHiz').flags : vis.zeroFlags

/** What a half's walk drew, and whether every slot with a pipeline found its group. */
type SlotWalk = { draws: number; complete: boolean }

/** What a recording walks besides its key's decisions: the runtime, its device and the half. Set
 *  before each `execute`, read only by a recording: nothing allocated on a replayed frame. */
const walking = {
  rt: undefined as WebgpuPagesRuntime | undefined,
  device: undefined as GPUDevice | undefined,
  rest: false,
  compacted: false,
}

/**
 * Records a half's slot draws (`walking`). A slot draws with its pipeline — its occluder slot's
 * when compacted, the twin for its opaque bins — and its group; a slot with a pipeline whose group
 * cannot be made yet leaves the walk incomplete, walked again next frame.
 */
const recordSlots: RecordBundle = (encoder): SlotWalk => {
  const { rest, compacted } = walking,
    rt = walking.rt!,
    device = walking.device!,
    { vis } = rt,
    indirect = prepared(vis, 'gpuDraw').indirectBuffer
  const walk = { draws: 0, complete: true }
  // No layout or no flags: no slot binds this frame, the key holding both.
  if (!vis.visBindGroupLayout || !halfFlags(vis, rest)) return walk
  // A coplanar layer is one more set of slots, drawn in the same order: its clusters carry their
  // pipeline's depth bias, those of layer 0 do not change.
  for (let layer = 0; layer < vis.drawLayerSlots; layer++) {
    const start = layer * BASE_SLOTS + (rest ? HALF_SLOTS : 0)
    for (let bin = 0; bin < HALF_SLOTS; bin++) {
      // A compacted tested slot draws with its occluder slot's pipeline, a half before.
      const s = start + bin,
        pipeline = visSlotPipeline(rt, rest && compacted ? s - HALF_SLOTS : s)
      if (!pipeline) continue
      const group = visGroupFor(rt, device, s, rest)
      if (!group) {
        walk.complete = false
        continue
      }
      encoder.setPipeline(drawnWith(pipeline, bin >= CULL_BINS))
      encoder.setBindGroup(0, group)
      encoder.drawIndirect(indirect, s * 16)
      walk.draws++
    }
  }
  return walk
}

/**
 * Draws the occluder half (`rest` false) or the tested half, by indirect commands, executed as the
 * half's render bundle (`rt.vis.visBundles`). A tested half whose rejected rows the compaction
 * removed (`compacted`) draws with the occluders' pipelines: every row it holds survives, so the
 * vertex stage has no verdict left to read.
 *
 * Each half draws its opaque slots, then its cutout ones (bins from `CULL_BINS`). An occluder
 * slot, or a compacted tested one, draws its opaque rows with the twin: their depth is down, early
 * rejected, before a cutout fragment reads its page. The call count depends only on the slot count,
 * never on the rows or on what the partition decided: each slot's instance count lives in the
 * indirect command the GPU wrote, and a slot nothing fills draws zero instances.
 *
 * The key holds what decides the walk, not the walk, nor what is the same for every key of a
 * half's bundles (the runtime, its device, the half): the compaction, the indirect buffer, the
 * layer count, the group layout and flags, the slot groups' revision (`visGroupsRevision`, moved
 * where they are voided), the layer pipelines and layer 0's six — a held frame compares these and
 * replays; the walk runs only when one moved. Each call counts on `rt.run.gpuDrawCalls`.
 */
export function drawVis(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pass: GPURenderPassEncoder,
  rest: boolean,
  compacted = false,
) {
  const { vis } = rt
  const bundles = vis.visBundles[rest ? 1 : 0],
    key = bundles.keyed(SLOT_BUNDLE)
  key.push(compacted, prepared(vis, 'gpuDraw').indirectBuffer, vis.drawLayerSlots)
  key.push(vis.visBindGroupLayout, halfFlags(vis, rest), vis.visGroupsRevision)
  key.push(vis.visLayerPipelines, vis.visLayerPipelines.length)
  key.push(vis.visPipelineBack, vis.visPipelineNone, vis.visPipelineFront)
  key.push(vis.visHizRestBack, vis.visHizRestNone, vis.visHizRestFront)
  walking.rt = rt
  walking.device = device
  walking.rest = rest
  walking.compacted = compacted
  const walk = bundles.execute(pass, device, recordSlots) as SlotWalk
  walking.rt = walking.device = undefined
  if (!walk.complete) bundles.forgetLatest()
  rt.run.gpuDrawCalls += walk.draws
}
