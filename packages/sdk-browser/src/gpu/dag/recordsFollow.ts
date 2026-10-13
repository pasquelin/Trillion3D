import { createWebgpuBindIdentity } from '../../webgpu/core/bindIdentity.ts'
import { rankGroups } from './listCap.ts'
import type { DagResources } from './resources.ts'

/** The identity of the placements' records a cut's groups bind (`worldTable.ts`): their view, held
 *  from the cut's setup. */
export function recordsIdentity(view: GPUTextureView) {
  const identity = createWebgpuBindIdentity()
  identity.next[0] = view
  identity.moved()
  return identity
}

/** The cut's groups made again — every range's and each kept list's (`rankGroups`) — when the
 *  placements' records they bind were remade, grown for the proxy's copies (`RecordTexture.hold`):
 *  followed by the view's identity, nothing made while it stands. */
export function followRecords(resources: DagResources) {
  const { recordsBound } = resources
  recordsBound.next[0] = resources.frames.worlds.view
  if (!recordsBound.moved()) return
  resources.ranges = resources.frames.bindGroups(resources.layout, resources.group)
  resources.rankGroups = rankGroups(resources)
}
