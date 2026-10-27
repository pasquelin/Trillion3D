import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import type { SceneTrace } from './sceneTraceResources.ts'
import { sceneTraceBindEntries } from './sceneTraceWgsl.ts'

/**
 * The bind group of the scene trace's resources (`sceneTraceBindEntries`) a pass binds beside its own: the one binder of it. The group it
 * returns is made again only where the layout it is made for or a resource of the scene trace (its parameters, nodes, triangles or table) is
 * not what the last call named.
 */
export function sceneTraceGroupBinder(device: GPUDevice) {
  const identity = createWebgpuBindIdentity()
  let group: GPUBindGroup | undefined
  return (
    layout: GPUBindGroupLayout,
    sceneTrace: Pick<SceneTrace, 'params' | 'nodes' | 'triangles' | 'table'>,
    first: number,
  ) => {
    const { next } = identity
    next[0] = layout
    next[1] = sceneTrace.params
    next[2] = sceneTrace.nodes
    next[3] = sceneTrace.triangles
    next[4] = sceneTrace.table
    if (identity.moved())
      group = device.createBindGroup({ layout, entries: sceneTraceBindEntries(sceneTrace, first) })
    return group!
  }
}
