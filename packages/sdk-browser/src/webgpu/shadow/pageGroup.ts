import { VIS_BINDINGS } from '../core/bindLayout.ts'
import { visBindEntries, type VisBindResources } from '../core/bindEntries.ts'
import { createWebgpuBindIdentity, entriesReady } from '../core/bindIdentity.ts'
import { liveResources } from '../core/liveEntries.ts'
import { visLayoutEntries } from '../visibility/shaders.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

/** Group 0's entries the shadow raster never reads: the raster's Hi-Z flags, camera uniform and
 *  slot lists. A vertex stage then reads four storage buffers there, within the eight any device
 *  holds. */
const UNREAD = new Set([
  VIS_BINDINGS.flags,
  VIS_BINDINGS.uniform,
  VIS_BINDINGS.instances,
  VIS_BINDINGS.slotOffsets,
])

/** Group 0's entries of the shadow raster (`../../vsm/renderRasterWgsl.ts`) and of the
 *  transmission's bin (`../../vsm/transmissionWgsl.ts`, compute): the visibility layout, less what
 *  neither reads, seen by the compute stage too. The bin's compute stage reads five storage buffers
 *  there and three of its own, the eight any device holds. */
export const shadowPageEntries = (): GPUBindGroupLayoutEntry[] =>
  visLayoutEntries()
    .filter((entry) => !UNREAD.has(entry.binding))
    .map((entry) => ({ ...entry, visibility: entry.visibility | GPUShaderStage.COMPUTE }))

/** Group 0's layout of the shadow raster and the transmission's bin (`shadowPageEntries`). */
export const shadowPageLayout = (device: GPUDevice) =>
  device.createBindGroupLayout({ entries: shadowPageEntries() })

/** The page rows as the visibility pass binds them, less what the raster never reads. */
const pageRowEntries = (rt: WebgpuPagesRuntime) =>
  visBindEntries(
    liveResources<VisBindResources>({
      cache: () => rt.gpu.cache?.buffer,
      position: () => rt.vis.concatPos,
      uv: () => rt.vis.concatUv,
      pageTable: () => rt.vis.pageTable,
      flags: () => undefined,
      uniform: () => undefined,
      uniformOffset: () => undefined,
      textures: () => rt.vis.textures,
      sampler: () => rt.vis.mapsSampler,
      instances: () => undefined,
      slotOffsets: () => undefined,
    }),
  ).filter(({ binding }) => !UNREAD.has(binding))

/** Each session's page rows group: its live entries and what they named, and the group made. */
const rowGroups = new WeakMap<
  WebgpuPagesRuntime,
  { identity: ReturnType<typeof createWebgpuBindIdentity>; group?: GPUBindGroup }
>()

/** Group 0 of the shadow raster, made again only when a resource it names changed identity,
 *  nothing allocated otherwise; undefined while one is missing. */
export function shadowPageGroup(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const layout = rt.lights.pageLayout
  if (!layout) return
  let held = rowGroups.get(rt)
  if (!held) rowGroups.set(rt, (held = { identity: createWebgpuBindIdentity() }))
  const entries = (held.identity.entries[0] ??= pageRowEntries(rt))
  if (held.identity.entriesMoved(layout)) held.group = undefined
  if (!entriesReady(entries)) return
  return (held.group ??= device.createBindGroup({ layout, entries }))
}
