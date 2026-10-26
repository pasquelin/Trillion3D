import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import type { DagResources } from './resources.ts'

/** The identity of the placements' records a cut's groups bind (`worlds/worldTable.ts`): their view, held
 *  from the cut's setup. */
export function recordsIdentity(view: GPUTextureView) {
  const identity = createWebgpuBindIdentity()
  identity.next[0] = view
  identity.moved()
  return identity
}

/** The cut's bind group made again over its group's members as they stand: after one was swapped. */
export function rebindCut(resources: DagResources) {
  resources.bindGroup = resources.frames.bindGroup(resources.layout, resources.group)
}

/** The cut's group made again when the placements' records it binds were remade (`RecordTexture.hold`): followed by the view's
 *  identity, nothing made while it stands. */
export function followRecords(resources: DagResources) {
  const { recordsBound } = resources
  recordsBound.next[0] = resources.frames.worlds.view
  if (recordsBound.moved()) rebindCut(resources)
}
