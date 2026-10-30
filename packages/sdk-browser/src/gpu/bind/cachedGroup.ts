import { createWebgpuBindIdentity } from './bindIdentity.ts'
import { entriesIdentity } from './entriesIdentity.ts'

/**
 * One bind group, made again only where the layout or a resource it names is not what a call before named (`createWebgpuBindIdentity`). With a `depth` of two, a group whose resources take turns frame after frame
 * (a double-buffered pair) finds each of them held and keeps a group for each, where a single identity would make it again every frame.
 * The call names the resources apart from the entries, which are listed only when the group is made; `over` is the call of a pass that lists its entries every image: the
 * layout and the resources the entries name are what moves the group.
 */
export function createCachedGroup(depth = 1) {
  const identity = createWebgpuBindIdentity(depth)
  const groups: GPUBindGroup[] = []
  const made = (
    device: GPUDevice,
    layout: GPUBindGroupLayout,
    entries: readonly GPUBindGroupEntry[] | (() => readonly GPUBindGroupEntry[]),
    label?: string,
  ) => {
    const moved = identity.moved()
    const at = identity.slot
    if (moved || !groups[at])
      groups[at] = device.createBindGroup({
        label,
        layout,
        entries: typeof entries === 'function' ? entries() : entries,
      })
    return groups[at]
  }
  return Object.assign(
    (
      device: GPUDevice,
      layout: GPUBindGroupLayout,
      resources: readonly unknown[],
      entries: () => GPUBindGroupEntry[],
      label?: string,
    ) => {
      const { next } = identity
      next.length = 0
      next.push(layout, ...resources)
      return made(device, layout, entries, label)
    },
    {
      over: (
        device: GPUDevice,
        layout: GPUBindGroupLayout,
        entries: readonly GPUBindGroupEntry[],
        label?: string,
      ) => {
        const { next } = identity
        next[0] = layout
        next.length = entriesIdentity(entries, next, 1)
        return made(device, layout, entries, label)
      },
    },
  )
}

/** What keeps bind groups by name: the targets of a pass family. */
export interface GroupCache {
  groups: Map<string, ReturnType<typeof createCachedGroup>>
}

/** The bind group `name` of `targets` over `layout`: kept while every resource it binds (`deps`) is the one it was made with, made from
 *  `entries` otherwise. The inputs are the same views from one image to the next unless the view is resized or its history trades places. */
export function groupFor(
  device: GPUDevice,
  targets: GroupCache,
  name: string,
  layout: GPUBindGroupLayout,
  deps: readonly unknown[],
  entries: () => GPUBindGroupEntry[],
) {
  let cache = targets.groups.get(name)
  if (!cache) targets.groups.set(name, (cache = createCachedGroup()))
  return cache(device, layout, deps, entries)
}
