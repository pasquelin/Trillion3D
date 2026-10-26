import { shadeBindEntries, type ShadeBindResources } from './bindEntries.ts'
import { entriesReady } from './bindIdentity.ts'
import { liveResources } from './liveEntries.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

/** The resolve's resources, each read live from its owner when the group is made or compared. */
export const shadeResources = (rt: WebgpuPagesRuntime) =>
  liveResources<ShadeBindResources>({
    visView: () => rt.vis.visView,
    cache: () => rt.gpu.cache?.buffer,
    position: () => rt.vis.concatPos,
    uv: () => rt.vis.concatUv,
    normal: () => rt.vis.concatNrm,
    pageTable: () => rt.vis.pageTable,
    textures: () => rt.vis.textures,
    sampler: () => rt.vis.mapsSampler,
    uniform: () => rt.vis.shadeUniform,
    material: () => rt.vis.materialTable.view,
    lobes: () => rt.gpu.surfaces?.lobesView,
    voxelSteps: () => rt.vis.voxelSteps?.buffer,
    frame: () => rt.gpu.device && rt.vis.graphFrame.bufferOn(rt.gpu.device),
  })

/** The resolve reads the same live descriptors for invalidation and group construction. */
export function ensureWebgpuShadeBindings(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis } = rt,
    identity = vis.shadeIdentity
  // The records of the surfaces go up before the group names their texture.
  vis.materialTable.viewFor(device)
  const entries = (identity.entries[0] ??= shadeBindEntries(shadeResources(rt)))
  if (identity.entriesMoved(vis.shadeBindGroupLayout)) vis.shadeBindGroup = undefined
  if (!vis.shadeBindGroup && vis.shadeBindGroupLayout && entriesReady(entries))
    vis.shadeBindGroup = device.createBindGroup({ layout: vis.shadeBindGroupLayout, entries })
}
