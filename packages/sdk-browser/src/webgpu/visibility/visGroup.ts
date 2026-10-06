import { visibilityEntries } from './bindings.ts'
import { entriesReady } from '../core/bindIdentity.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

/** The bind group of one indirect slot, cached on `rt.vis` until the visibility identity voids it:
 *  slot groups share every resource with the representative slot 0 but their uniform offset,
 *  and are built only when every resource their entries name exists. Shadow depth passes reuse
 *  exactly these groups: same page table, same selection, same slot uniform. */
export function visGroupFor(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  slot: number,
  rest: boolean,
) {
  const { vis } = rt,
    layout = vis.visBindGroupLayout,
    key = slot * 2 + (rest ? 1 : 0)
  // Checked before the cache: a dropped Hi-Z buffer is never bound in the frame it goes.
  if (!layout || !vis.gpuDraw || !(rest ? vis.gpuHiz?.flags : vis.zeroFlags)) return
  if (vis.visSlotGroups[key]) return vis.visSlotGroups[key]
  const entries = visibilityEntries(rt, rest, slot)
  if (!entriesReady(entries)) return
  return (vis.visSlotGroups[key] = device.createBindGroup({ layout, entries }))
}
