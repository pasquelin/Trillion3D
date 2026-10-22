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
import { askVoxelTwin } from './pipelines.ts'
import { visGroupFor } from './visGroup.ts'
import type { RenderCommands } from '../../gpu/core/renderBundles.ts'
import { prepared } from '../../frame/backend/state/prepared.ts'

/** The kind of rows bin `bin` of a half holds (`BIN_KIND`). */
const binKind = (bin: number) => Math.floor(bin / CULL_BINS) as BinKind

/** Whether bin `bin` of a half is walked: a voxel bin only while the table holds a voxel row, and
 *  never the two-sided one, which no voxel row takes (`rowSide`); a software bin only by a walk
 *  that shows every triangle the cut submitted (`software`, the x-ray view's): the hardware raster
 *  draws none of its rows. */
const walked = (bin: number, voxels: boolean, software: boolean) => {
  const kind = binKind(bin)
  if (kind === BIN_KIND.SOFTWARE) return software
  return kind !== BIN_KIND.VOXEL || (voxels && bin % CULL_BINS !== BIN_NONE)
}

/** What a half's walk drew, and whether every slot with a pipeline found its group. */
export type SlotWalk = { draws: number; complete: boolean }

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
