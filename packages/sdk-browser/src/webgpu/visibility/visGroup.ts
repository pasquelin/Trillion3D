import { visibilityEntries } from './bindings.ts'
import { entriesReady } from '../core/bindIdentity.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

/** The bind group of one indirect slot, cached on `rt.vis` until the visibility identity voids it:
 *  slot groups share every resource with the representative slot 0 but their uniform offset,
 *  and are built only when every resource their entries name exists. Shadow depth passes reuse
 *  exactly these groups: same page table, same selection, same slot uniform. */
export function visGroupFor(rt: WebgpuPagesRuntime, device: GPUDevice, slot: number) {
  const { vis } = rt,
    layout = vis.visBindGroupLayout
  if (!layout || !vis.gpuDraw || !vis.zeroFlags) return
  if (vis.visSlotGroups[slot]) return vis.visSlotGroups[slot]
  // The surfaces' records go up before a group names their texture.
  vis.materialTable.viewFor(device)
  const entries = visibilityEntries(rt, false, slot)
  if (!entriesReady(entries)) return
  return (vis.visSlotGroups[slot] = device.createBindGroup({ layout, entries }))
}
