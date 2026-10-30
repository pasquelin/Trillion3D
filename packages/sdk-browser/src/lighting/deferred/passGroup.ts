import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'

/**
 * A lighting pass's bind group over the resources it names, made again only when one of them is
 * replaced (`bindIdentity.ts`). Two identities are held, a group each: resources that take turns
 * frame by frame — the two histories, the two HDR targets — keep their groups, where one identity
 * would move, and the group be made again, every image. A `layout` given as a function is asked at the first group made: a pass that
 * never runs makes none.
 */
export function createPassGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout | (() => GPUBindGroupLayout),
) {
  const identity = createWebgpuBindIdentity(2)
  const held: (GPUBindGroup | undefined)[] = []
  return {
    /** The group over `named`, the resources its entries are made of (always in the same order);
     *  `entries` makes them, and is called only when a group is to be made. */
    get(named: readonly unknown[], entries: () => GPUBindGroupEntry[]) {
      const { next } = identity
      next.length = named.length
      for (let at = 0; at < named.length; at++) next[at] = named[at]
      const kept = identity.moved() ? undefined : held[identity.slot]
      if (kept) return kept
      // Until it is made, the slot holds no group: a refused one is asked again.
      held[identity.slot] = undefined
      return (held[identity.slot] = device.createBindGroup({
        layout: typeof layout === 'function' ? layout() : layout,
        entries: entries(),
      }))
    },
    /** Every group forgotten. */
    release() {
      identity.clear()
      held.length = 0
    },
  }
}
