import { visBindEntries, type VisBindResources } from '../core/bindEntries.ts'
import { liveResources } from '../core/liveEntries.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

export function visibilityEntries(rt: WebgpuPagesRuntime, hiz: boolean, slot = -1) {
  return visBindEntries(
    liveResources<VisBindResources>({
      cache: () => rt.gpu.cache?.buffer,
      position: () => rt.vis.concatPos,
      uv: () => rt.vis.concatUv,
      pageTable: () => rt.vis.pageTable,
      flags: () => (hiz ? rt.vis.gpuHiz?.flags : rt.vis.zeroFlags),
      uniform: () => rt.vis.visUniform,
      uniformOffset: () => (slot + 1) * 256,
      textures: () => rt.vis.textures,
      sampler: () => rt.vis.mapsSampler,
      instances: () => (slot < 0 ? rt.vis.zeroFlags : rt.vis.gpuDraw?.instanceBuffer),
      slotOffsets: () => (slot < 0 ? rt.vis.zeroFlags : rt.vis.gpuDraw?.slotOffsetsBuffer),
    }),
  )
}

/** The descriptors used to create the groups are also their identity, including atlas tables.
 *  Slot groups differ from the representative slot 0 by their uniform offset alone. */
function voidStaleVisibilityGroups(rt: WebgpuPagesRuntime) {
  const { vis } = rt,
    identity = vis.visIdentity
  identity.entries[0] ??= visibilityEntries(rt, false)
  identity.entries[1] ??= visibilityEntries(rt, true)
  identity.entries[2] ??= visibilityEntries(rt, false, 0)
  if (!identity.entriesMoved(vis.visBindGroupLayout)) return
  vis.visSlotGroups.fill(undefined)
  vis.visGroupsRevision++
  vis.rasterGroups.fill(undefined)
}

/** The image's visibility groups follow what their entries name: the slot and raster groups that
 *  named a moved resource are voided, made again by the passes that bind them (`visGroup.ts`). */
export function ensureWebgpuVisibilityBindings(rt: WebgpuPagesRuntime) {
  voidStaleVisibilityGroups(rt)
}
