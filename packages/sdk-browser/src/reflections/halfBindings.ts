import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
} from '../gpu/core/computeBindings.ts'
import type { SceneBindings } from '../bounce/sceneBindings.ts'
import { REFLECTION_FORMAT } from './constants.ts'
import { FRONT_TRACED_FORMAT } from './frontLayer.ts'
import { HALF_FORMAT } from './halfTexture.ts'

/**
 * THE ONE TABLE OF THE REFLECTIONS' GROUP 0, shared by the trace, the temporal accumulation and the
 * upsample (`traceHalf.ts`): the WGSL declarations, the layouts and the entries read their numbers here.
 * A group serves one surface — the opaque one or the transparents' front one (`frontLayer.ts`) — and one
 * parity of the history's turn about (`halfEncode.ts`): its flags, normals and lobes (its depth is the
 * reflection group's), the lights (the upsample's weight reads their fitted table too), what the trace
 * reads of the scene — the light grid's world lists, the bounce cascades and their probes, the proxy's
 * buffer, the culling's worlds and its placement tree —, and the half grids each kernel reads or
 * writes (`halfTexture.ts`). The opaque upsample writes the reflection target the resolve reads, the
 * front one the radiance the forward fragments read.
 */
export const REFLECTION_TRACE_BINDINGS = {
  flags: 0,
  normals: 1,
  lobes: 2,
  lights: 3,
  lightLists: 4,
  bounceGrid: 5,
  probes: 6,
  proxy: 7,
  proxyWorlds: 8,
  proxyTree: 9,
  traceOut: 10,
  temporalIn: 11,
  historyIn: 12,
  historyOut: 13,
  upsampleIn: 14,
  base: 15,
  target: 16,
  frontTarget: 17,
} as const

const B = REFLECTION_TRACE_BINDINGS

/** The proxy's bindings in the trace's group 0, the table's. */
export const TRACE_SCENE_BINDINGS: SceneBindings = {
  group: 0,
  proxy: B.proxy,
  worlds: B.proxyWorlds,
  tree: B.proxyTree,
}

/** The surface every kernel reads: its flags, normals and lobes. */
const surface = () => [
  computeTextureEntry(B.flags, 'uint'),
  computeTextureEntry(B.normals, 'unfilterable-float'),
  computeTextureEntry(B.lobes, 'uint'),
]

/** The layouts of each kernel's group 0: the trace, the temporal accumulation, and the two upsamples. */
export const halfLayouts = (device: GPUDevice) => {
  const layout = (entries: GPUBindGroupLayoutEntry[]) =>
    device.createBindGroupLayout({ entries: [...surface(), ...entries] })
  return {
    trace: layout([
      computeBufferEntry(B.lights, 'read-only-storage'),
      computeBufferEntry(B.lightLists, 'read-only-storage'),
      computeBufferEntry(B.bounceGrid, 'uniform'),
      computeTextureEntry(B.probes, 'unfilterable-float', '2d-array'),
      computeBufferEntry(B.proxy, 'read-only-storage'),
      computeTextureEntry(B.proxyWorlds, 'uint', '2d-array'),
      computeTextureEntry(B.proxyTree, 'uint', '2d-array'),
      computeStorageTextureEntry(B.traceOut, HALF_FORMAT),
    ]),
    temporal: layout([
      computeTextureEntry(B.temporalIn, 'uint'),
      computeTextureEntry(B.historyIn, 'uint'),
      computeStorageTextureEntry(B.historyOut, HALF_FORMAT),
    ]),
    upsample: layout([
      computeBufferEntry(B.lights, 'read-only-storage'),
      computeTextureEntry(B.upsampleIn, 'uint'),
      computeTextureEntry(B.base, 'unfilterable-float'),
      computeStorageTextureEntry(B.target, REFLECTION_FORMAT),
    ]),
    upsampleFront: layout([
      computeTextureEntry(B.upsampleIn, 'uint'),
      computeStorageTextureEntry(B.frontTarget, FRONT_TRACED_FORMAT),
    ]),
  }
}
export type HalfLayouts = ReturnType<typeof halfLayouts>
