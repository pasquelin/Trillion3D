import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import type { WebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'

/** One program's bind groups: what they name (`WebgpuBindIdentity`, two held, the images taking
 *  turns), and the group made for each identity held, by its slot. */
export interface ProgramGroups {
  identity: WebgpuBindIdentity
  groups: (GPUBindGroup | undefined)[]
}

/** Groups of `size` threads that cover `n` cells. */
export const threads = (n: number, size: number) => ceilDiv(n, size)

/** The group held for the identity just named (`next`), none where it moved: the group then held at
 *  its slot was made for another. */
export function heldGroup({ identity, groups }: ProgramGroups) {
  if (identity.moved()) groups[identity.slot] = undefined
  return groups[identity.slot]
}

/** A group made for the identity just named, kept at its slot. */
export function keptGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  { identity, groups }: ProgramGroups,
  entries: GPUBindGroupEntry[],
) {
  return (groups[identity.slot] = device.createBindGroup({
    label: 'Trillion3D fog',
    layout,
    entries,
  }))
}
