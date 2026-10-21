import { uniformStride } from '../../session/memory/pools.ts'
import { visBindEntries, type VisBindResources } from '../../gpu/bind/bindEntries.ts'
import { liveResources } from '../../gpu/bind/liveEntries.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

export function visibilityEntries(rt: WebgpuPagesRuntime, slot = -1) {
  return visBindEntries(
    liveResources<VisBindResources>({
      cache: () => rt.gpu.cache?.buffer,
      position: () => rt.vis.concatPos,
      uv: () => rt.vis.concatUv,
      pageTable: () => rt.vis.pageTable,
      uniform: () => rt.vis.visUniform,
      // The uniform's slots lie the device's alignment apart (`visUniformLayout`).
      uniformOffset: () => (slot + 1) * uniformStride(rt.gpu.device?.limits),
      textures: () => rt.vis.textures,
      sampler: () => rt.vis.mapsSampler,
      instances: () => (slot < 0 ? rt.vis.zeroRows : rt.vis.gpuDraw?.instanceBuffer),
      slotOffsets: () => (slot < 0 ? rt.vis.zeroRows : rt.vis.gpuDraw?.groupsBuffer),
      material: () => rt.vis.materialTable.view,
      normals: () => rt.vis.concatNrm,
    }),
  )
}

/** The descriptors that create the groups are also their identity, including atlas tables.
 *  Slot groups differ from the representative slot 0 by their uniform offset alone. */
function voidStaleVisibilityGroups(rt: WebgpuPagesRuntime) {
  const { vis } = rt,
    identity = vis.visIdentity
  identity.entries[0] ??= visibilityEntries(rt)
  identity.entries[1] ??= visibilityEntries(rt, 0)
  if (!identity.entriesMoved(vis.visBindGroupLayout)) return
  vis.visSlotGroups.fill(undefined)
  vis.visGroupsRevision++
}

/** The image's visibility groups follow what their entries name: the slot groups that named a
 *  moved resource are voided, made again by the passes that bind them (`visGroup.ts`); the
 *  raster's own groups follow theirs (`../raster/bindings.ts`). */
export function ensureWebgpuVisibilityBindings(rt: WebgpuPagesRuntime) {
  // The records the rows wrote go up before a group names their texture.
  const { materialTable } = rt.vis,
    device = rt.gpu.device
  if (device) materialTable.viewFor(device)
  voidStaleVisibilityGroups(rt)
}
