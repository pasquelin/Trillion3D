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
 * THE ONE TABLE OF THE REFLECTIONS' GROUP 0, shared by the trace and the upsample (`traceHalf.ts`): the
 * WGSL declarations, the layouts and the entries read their numbers here. Both read the two surfaces —
 * the opaque one's flags, normals and lobes, the transparents' front one's (`frontLayer.ts`), whose depths
 * are the reflection group's — and the lights (the upsample's weight reads their fitted table). The trace
 * reads the light grid's world lists, the bounce cascades and their probes, the proxy's buffer, the
 * culling's worlds and its placement tree, and writes each surface's half grid (`halfTexture.ts`); the
 * upsample reads both half grids and the opaque surface's base colour, and writes the reflection target
 * the resolve reads and the front's radiance the forward fragments read.
 */
export const REFLECTION_TRACE_BINDINGS = {
  flags: 0,
  normals: 1,
  lobes: 2,
  frontFlags: 3,
  frontNormals: 4,
  frontLobes: 5,
  lights: 6,
  lightLists: 7,
  bounceGrid: 8,
  probes: 9,
  proxy: 10,
  proxyWorlds: 11,
  proxyTree: 12,
  halfOut: 13,
  frontHalfOut: 14,
  half: 15,
  frontHalf: 16,
  base: 17,
  target: 18,
  frontTarget: 19,
} as const

const B = REFLECTION_TRACE_BINDINGS

/** The proxy's bindings in the trace's group 0, the table's. */
export const TRACE_SCENE_BINDINGS: SceneBindings = {
  group: 0,
  proxy: B.proxy,
  worlds: B.proxyWorlds,
  tree: B.proxyTree,
}

/** The surfaces both kernels read: the opaque and the front ones' flags, normals and lobes. */
const surfaceEntries = () => [
  computeTextureEntry(B.flags, 'uint'),
  computeTextureEntry(B.normals, 'unfilterable-float'),
  computeTextureEntry(B.lobes, 'uint'),
  computeTextureEntry(B.frontFlags, 'uint'),
  computeTextureEntry(B.frontNormals, 'unfilterable-float'),
  computeTextureEntry(B.frontLobes, 'uint'),
  computeBufferEntry(B.lights, 'read-only-storage'),
]

/** The trace's group 0 and the upsample's layouts. */
export const halfLayouts = (device: GPUDevice) => ({
  traceLayout: device.createBindGroupLayout({
    entries: [
      ...surfaceEntries(),
      computeBufferEntry(B.lightLists, 'read-only-storage'),
      computeBufferEntry(B.bounceGrid, 'uniform'),
      computeTextureEntry(B.probes, 'unfilterable-float', '2d-array'),
      computeBufferEntry(B.proxy, 'read-only-storage'),
      computeTextureEntry(B.proxyWorlds, 'uint', '2d-array'),
      computeTextureEntry(B.proxyTree, 'uint', '2d-array'),
      computeStorageTextureEntry(B.halfOut, HALF_FORMAT),
      computeStorageTextureEntry(B.frontHalfOut, HALF_FORMAT),
    ],
  }),
  upsampleLayout: device.createBindGroupLayout({
    entries: [
      ...surfaceEntries(),
      computeTextureEntry(B.half, 'uint'),
      computeTextureEntry(B.frontHalf, 'uint'),
      computeTextureEntry(B.base, 'unfilterable-float'),
      computeStorageTextureEntry(B.target, REFLECTION_FORMAT),
      computeStorageTextureEntry(B.frontTarget, FRONT_TRACED_FORMAT),
    ],
  }),
})
