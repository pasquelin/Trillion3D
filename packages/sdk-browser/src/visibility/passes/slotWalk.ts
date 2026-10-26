import { visSlotPipeline } from '../../frame/prepare/pipelineFor.ts'
import {
  BASE_SLOTS,
  BIN_KIND,
  BIN_NONE,
  CULL_BINS,
  HALF_SLOTS,
  type BinKind,
} from '../bins/contract.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { askVoxelTwin } from './pipelines.ts'
import { visGroupFor } from './visGroup.ts'
import type { RenderCommands } from '../../gpu/core/renderBundles.ts'
import { prepared } from '../../frame/backend/state/prepared.ts'
import { presentClassKeys, type PresentClasses } from '../../gpu/core/presentClasses.ts'
import { FEATURE_CLASS_KEYS } from '../shader/materialClass.ts'
import { CLASS_FEATURE } from '../shader/classWords.ts'

/** The kind of rows bin `bin` of a half holds (`BIN_KIND`). */
const binKind = (bin: number) => Math.floor(bin / CULL_BINS) as BinKind

/** Whether the scene holds a voxel cluster: a class of the resident clusters is a voxel's. The voxel
 *  slots are walked only then. */
export function voxelsPresent(rt: WebgpuPagesRuntime) {
  const classes = rt.vis.presentClasses,
    keys = presentClassKeys(classes)
  let seen = voxelsSeen.get(classes)
  if (seen?.revision === classes.revision) return seen.present
  let present = false
  for (let i = 0; !present && i < keys.length; i++)
    present = keys[i] < FEATURE_CLASS_KEYS && (keys[i] & CLASS_FEATURE.VOXEL) !== 0
  if (!seen) voxelsSeen.set(classes, (seen = { revision: 0, present }))
  seen.revision = classes.revision
  seen.present = present
  return present
}

/** What `voxelsPresent` last found for a set of classes, and the listing it found it in. */
const voxelsSeen = new WeakMap<PresentClasses, { revision: number; present: boolean }>()

/** Whether bin `bin` of a half is walked: a voxel bin only while the scene holds a voxel cluster,
 *  and never the two-sided one, which no voxel cluster takes (`FLAG_BACK`); a software bin only by a
 *  walk that shows every triangle the cut submitted (`software`, the x-ray view's): the hardware
 *  raster draws none of its clusters. */
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
    indirect = prepared(vis, 'gpuBins').indirectBuffer
  const walk = { draws: 0, complete: true }
  // No layout: no slot binds this frame, the key holding it.
  if (!vis.visBindGroupLayout) return walk
  // A voxel cluster draws on layer 0 alone (`../bins/binsWgsl.ts`).
  const voxels = voxelsPresent(rt)
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
