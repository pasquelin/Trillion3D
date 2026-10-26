import { grantsVertexTextures } from '../../../gpu/core/vertexTextures.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { VIS_BINDINGS } from '../../../gpu/bind/bindLayout.ts'
import { createWebgpuBindIdentity, entriesReady } from '../../../gpu/bind/bindIdentity.ts'
import { bufferEntry } from '../../../gpu/bind/liveEntries.ts'
import { visibilityEntries } from '../../../visibility/passes/bindings.ts'
import { visLayoutEntries } from '../../../visibility/passes/shaders.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'

/** Group 0's entries the shadow raster never reads: the raster's camera uniform and slot lists.
 *  A vertex stage then reads four storage buffers there, within the eight any device holds. */
const UNREAD = new Set([VIS_BINDINGS.uniform, VIS_BINDINGS.instances, VIS_BINDINGS.slotOffsets])

/** Group 0's entries of the shadow raster (`../vsm/render/renderRasterWgsl.ts`): the visibility
 *  layout, less what it never reads. */
const shadowPageEntries = (device: GPUDevice): GPUBindGroupLayoutEntry[] =>
  visLayoutEntries(grantsVertexTextures(device)).filter((entry) => !UNREAD.has(entry.binding))

/** Group 0's layout of the shadow raster (`shadowPageEntries`): one a device, every session's, so
 *  the raster pipelines made on it serve them all (`vsmRasterPipe`). */
export const shadowPageLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({ entries: shadowPageEntries(device) }),
)

/** Group 0's entries of the shadow raster's software half (`../vsm/render/renderSoftwareWgsl.ts`):
 *  the same, seen by the compute stage. */
export const shadowPageComputeEntries = (device: GPUDevice): GPUBindGroupLayoutEntry[] =>
  shadowPageEntries(device).map((entry) => ({ ...entry, visibility: GPUShaderStage.COMPUTE }))

/** Their layout, one a device: the group the frame binds is made on it (`shadowPageComputeGroup`). */
export const shadowPageComputeLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    label: 'Trillion3D shadow page rows, compute',
    entries: shadowPageComputeEntries(device),
  }),
)

/** The page rows as the visibility pass binds them (`visibilityEntries`), less what the raster
 *  never reads, and the decoded clusters of the casters (`casterFeed.ts`) where the visibility pass
 *  binds its own: the raster draws the clusters the candidates listed, not the ones the camera cut
 *  drew. Read live: the casters' buffers are made again when the clusters that may cast outgrow them. */
const pageRowEntries = (rt: WebgpuPagesRuntime) =>
  visibilityEntries(rt)
    .filter(({ binding }) => !UNREAD.has(binding))
    .map((entry) =>
      entry.binding === VIS_BINDINGS.pageTable
        ? bufferEntry(entry.binding, () => rt.lights.casters?.pages)
        : entry,
    )

/** Each session's page rows group: its live entries and what they named, and the group made —
 *  the raster's, and its compute twin's. */
const rowGroups = new WeakMap<
  WebgpuPagesRuntime,
  {
    identity: ReturnType<typeof createWebgpuBindIdentity>
    group?: GPUBindGroup
    compute?: GPUBindGroup
  }
>()

/** Group 0 of the shadow raster, made again only when a resource it names changed identity,
 *  nothing allocated otherwise; undefined while one is missing. */
export function shadowPageGroup(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const layout = rt.lights.pageLayout
  if (!layout) return
  // The records the rows wrote go up before the group names their texture.
  rt.vis.materialTable.viewFor(device)
  let held = rowGroups.get(rt)
  if (!held) rowGroups.set(rt, (held = { identity: createWebgpuBindIdentity() }))
  const entries = (held.identity.entries[0] ??= pageRowEntries(rt))
  if (held.identity.entriesMoved(layout)) held.group = held.compute = undefined
  if (!entriesReady(entries)) return
  return (held.group ??= device.createBindGroup({ layout, entries }))
}

/** The page rows group of the software half (`shadowPageComputeLayout`), over the entries of
 *  `shadowPageGroup` — made after it, made again with it —; undefined while the raster's is. */
export function shadowPageComputeGroup(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (!shadowPageGroup(rt, device)) return
  const held = rowGroups.get(rt)!
  const layout = shadowPageComputeLayout(device)
  return (held.compute ??= device.createBindGroup({
    layout,
    entries: held.identity.entries[0]!,
  }))
}
