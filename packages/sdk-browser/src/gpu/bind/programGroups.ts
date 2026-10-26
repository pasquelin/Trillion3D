import { createWebgpuBindIdentity, type WebgpuBindIdentity } from './bindIdentity.ts'

/** One program's bind groups: what they name (`WebgpuBindIdentity`, two held, the images taking
 *  turns), and the group made for each identity held, by its slot. */
export interface ProgramGroups {
  identity: WebgpuBindIdentity
  groups: (GPUBindGroup | undefined)[]
}

/** A program's bind groups, none made yet. */
export const createProgramGroups = (): ProgramGroups => ({
  identity: createWebgpuBindIdentity(2),
  groups: [],
})

/** The group held for the identity just named (`next`), none where it moved: the group then held at
 *  its slot was made for another. */
export function heldProgramGroup({ identity, groups }: ProgramGroups) {
  if (identity.moved()) groups[identity.slot] = undefined
  return groups[identity.slot]
}

/** A group made for the identity just named, kept at its slot, labelled `label`. */
export function keptProgramGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  { identity, groups }: ProgramGroups,
  entries: GPUBindGroupEntry[],
  label = 'Trillion3D fog',
) {
  return (groups[identity.slot] = device.createBindGroup({
    label,
    layout,
    entries,
  }))
}
