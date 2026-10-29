import { createWebgpuBindIdentity } from './bindIdentity.ts'

/**
 * One bind group, made again only where the layout or a resource it names is not what a call before named (`createWebgpuBindIdentity`). With a `depth` of two, a group whose resources take turns frame after frame
 * (a double-buffered pair) finds each of them held and keeps a group for each, where a single identity would make it again every frame.
 */
export function createCachedGroup(depth = 1) {
  const identity = createWebgpuBindIdentity(depth)
  const groups: GPUBindGroup[] = []
  return (
    device: GPUDevice,
    layout: GPUBindGroupLayout,
    resources: readonly unknown[],
    entries: () => GPUBindGroupEntry[],
    label?: string,
  ) => {
    const { next } = identity
    next.length = 0
    next.push(layout, ...resources)
    const moved = identity.moved()
    const at = identity.slot
    if (moved || !groups[at])
      groups[at] = device.createBindGroup({ label, layout, entries: entries() })
    return groups[at]
  }
}
