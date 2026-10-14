import { computeBufferEntry, computeTextureEntry } from '../gpu/core/computeBindings.ts'
import type { RuntimeBindings } from '../bounce/runtimeAnswerWgsl.ts'
import { storageEntry, storeEntry } from './bindings.ts'
import { FRONT_TRACED_FORMAT } from './frontLayer.ts'

/**
 * THE ONE TABLE OF THE TRACE'S GROUP 0, shared by the classification and the trace: the WGSL
 * declarations, the layouts and the entries read their numbers here. The surface targets, the
 * target it writes, the lights, the bounce cascades and their probes, the indirect arguments
 * (`work`), the trace's list with the frame's counters, the store of the run-time proxy's answers,
 * the proxy's buffer and instances, the
 * culling's worlds it places its meshes by and the placement tree its rays walk, the light grid's buffer, whose world
 * lists the proxy hits walk, and the transparents' front surface (`frontLayer.ts`): its flags, normals and lobes
 * — its depth is the reflection group's (`REFLECTION_FRONT_BINDING`) —, and the target its traced radiance is
 * written to.
 */
export const TRACE_BINDINGS = {
  flags: 0,
  normals: 1,
  target: 2,
  lights: 3,
  lobes: 4,
  bounceGrid: 5,
  probes: 6,
  work: 7,
  list: 8,
  store: 9,
  base: 10,
  proxy: 11,
  proxyWorlds: 12,
  proxyTree: 13,
  lightLists: 17,
  frontFlags: 18,
  frontNormals: 19,
  frontLobes: 20,
  frontTarget: 21,
} as const

/** The bindings of the proxy in the trace's group 0 (`bounce/runtimeAnswerWgsl.ts`), the table's. */
export const RUNTIME_BINDINGS: RuntimeBindings = {
  group: 0,
  proxy: TRACE_BINDINGS.proxy,
  worlds: TRACE_BINDINGS.proxyWorlds,
  tree: TRACE_BINDINGS.proxyTree,
  list: TRACE_BINDINGS.list,
  store: TRACE_BINDINGS.store,
}

/** The frame state's group (`BEGIN_SHADER`): the indirect arguments and the trace's list. */
export const BEGIN_BINDINGS = { work: 2, list: 4 } as const

/** The trace's bind group 0 and the frame state's layouts. */
export function traceLayouts(device: GPUDevice) {
  return {
    traceLayout: device.createBindGroupLayout({
      entries: [
        computeTextureEntry(TRACE_BINDINGS.flags, 'uint'),
        computeTextureEntry(TRACE_BINDINGS.normals, 'unfilterable-float'),
        storageEntry(TRACE_BINDINGS.target),
        computeBufferEntry(TRACE_BINDINGS.lights, 'read-only-storage'),
        computeTextureEntry(TRACE_BINDINGS.lobes, 'uint'),
        computeBufferEntry(TRACE_BINDINGS.bounceGrid, 'uniform'),
        computeTextureEntry(TRACE_BINDINGS.probes, 'unfilterable-float', '2d-array'),
        computeBufferEntry(TRACE_BINDINGS.list, 'storage'),
        storeEntry(TRACE_BINDINGS.store),
        computeTextureEntry(TRACE_BINDINGS.base, 'unfilterable-float'),
        computeBufferEntry(TRACE_BINDINGS.lightLists, 'read-only-storage'),
        computeBufferEntry(TRACE_BINDINGS.proxy, 'read-only-storage'),
        computeTextureEntry(TRACE_BINDINGS.proxyWorlds, 'uint', '2d-array'),
        computeTextureEntry(TRACE_BINDINGS.proxyTree, 'uint', '2d-array'),
        computeTextureEntry(TRACE_BINDINGS.frontFlags, 'uint'),
        computeTextureEntry(TRACE_BINDINGS.frontNormals, 'unfilterable-float'),
        computeTextureEntry(TRACE_BINDINGS.frontLobes, 'uint'),
        storageEntry(TRACE_BINDINGS.frontTarget, FRONT_TRACED_FORMAT),
      ],
    }),
    classifyLayout: device.createBindGroupLayout({
      entries: [
        computeTextureEntry(TRACE_BINDINGS.flags, 'uint'),
        computeTextureEntry(TRACE_BINDINGS.frontFlags, 'uint'),
        computeBufferEntry(TRACE_BINDINGS.work, 'storage'),
        computeBufferEntry(TRACE_BINDINGS.list, 'storage'),
      ],
    }),
    beginLayout: device.createBindGroupLayout({
      entries: [
        computeBufferEntry(BEGIN_BINDINGS.work, 'storage'),
        computeBufferEntry(BEGIN_BINDINGS.list, 'storage'),
      ],
    }),
  }
}
