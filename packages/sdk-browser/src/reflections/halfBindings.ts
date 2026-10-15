import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
} from '../gpu/core/computeBindings.ts'
import { sceneLayoutEntries, type SceneBindings } from '../bounce/sceneBindings.ts'
import { atlasEntry } from '../bounce/atlas.ts'
import { HDR_FORMAT } from '../scene/targetFormats.ts'
import { FRONT_TRACED_FORMAT } from './frontLayer.ts'
import { HALF_FORMAT } from './halfTexture.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'

/** The surface a half-grid kernel's pipeline works on — 0 the opaque, 1 the transparents' front
 *  (`frontLayer.ts`) —, given by the pipeline (`createTraceStages`): one entry a kernel, two
 *  pipelines, the same specialisation two entries made. */
export const REFLECTION_LAYER_WGSL = wgslBlock(
  'REFLECTION_LAYER_WGSL',
  [],
  'override REFLECTION_LAYER:u32;',
)

/**
 * THE ONE TABLE OF THE REFLECTIONS' GROUP 0, shared by the trace, the spatial reuse, the temporal
 * accumulation and the upsample (`traceHalf.ts`): the WGSL declarations, the layouts and the entries read their numbers here.
 * A group serves one surface — the opaque one or the transparents' front one (`frontLayer.ts`) — and one
 * parity of the history's turn about (`halfEncode.ts`): its flags, normals and lobes (its depth is the
 * reflection group's), what a ray reads of the scene — the lights, the light grid's world lists, the
 * bounce cascades and their probes, the proxy's buffer, the culling's worlds and its placement tree —,
 * which the trace and the upsamples (a mirror lobe's ray) read, and the half grids each kernel reads or
 * writes (`halfTexture.ts`). The trace tells the settle whether it sampled a lobe (`sampled`). The opaque
 * upsample writes the reflection target the resolve reads, the front one the radiance the forward
 * fragments read.
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
  spatialIn: 11,
  spatialOut: 12,
  temporalIn: 13,
  historyIn: 14,
  historyOut: 15,
  upsampleIn: 16,
  base: 17,
  target: 18,
  frontTarget: 19,
  sampled: 20,
} as const

const B = REFLECTION_TRACE_BINDINGS

/** The proxy's bindings in the trace's group 0, the table's. */
export const TRACE_SCENE_BINDINGS: SceneBindings = {
  group: 0,
  proxy: B.proxy,
  worlds: B.proxyWorlds,
  tree: B.proxyTree,
}

/** The surface every kernel reads: its normals and lobes. */
const surface = () => [
  computeTextureEntry(B.normals, 'unfilterable-float'),
  computeTextureEntry(B.lobes, 'uint'),
]

/** The surface's flags, which the trace and the upsamples read (`surfaceFlagsAt`); the spatial reuse
 *  and the accumulation take a pixel's lobe without them. */
const flags = () => computeTextureEntry(B.flags, 'uint')

/** What a ray reads of the scene — the lights, the light grid's lists, the bounce cascades and their
 *  probes, the proxy and the culling's worlds and tree. */
const scene = () => [
  computeBufferEntry(B.lights, 'read-only-storage'),
  computeBufferEntry(B.lightLists, 'read-only-storage'),
  computeBufferEntry(B.bounceGrid, 'uniform'),
  atlasEntry(B.probes),
  ...sceneLayoutEntries(TRACE_SCENE_BINDINGS),
]

/** The layouts of each kernel's group 0: the trace — which alone sets the settle's word —, the
 *  spatial reuse, the temporal accumulation, and the two upsamples. */
export const halfLayouts = (device: GPUDevice) => {
  const layout = (entries: GPUBindGroupLayoutEntry[]) =>
    device.createBindGroupLayout({ entries: [...surface(), ...entries] })
  return {
    trace: layout([
      flags(),
      ...scene(),
      computeBufferEntry(B.sampled, 'storage'),
      computeStorageTextureEntry(B.traceOut, HALF_FORMAT),
    ]),
    spatial: layout([
      computeTextureEntry(B.spatialIn, 'uint'),
      computeStorageTextureEntry(B.spatialOut, HALF_FORMAT),
    ]),
    temporal: layout([
      computeTextureEntry(B.temporalIn, 'uint'),
      computeTextureEntry(B.historyIn, 'uint'),
      computeStorageTextureEntry(B.historyOut, HALF_FORMAT),
    ]),
    upsample: layout([
      flags(),
      ...scene(),
      computeTextureEntry(B.upsampleIn, 'uint'),
      computeTextureEntry(B.base, 'unfilterable-float'),
      computeStorageTextureEntry(B.target, HDR_FORMAT),
    ]),
    upsampleFront: layout([
      flags(),
      ...scene(),
      computeTextureEntry(B.upsampleIn, 'uint'),
      computeStorageTextureEntry(B.frontTarget, FRONT_TRACED_FORMAT),
    ]),
  }
}
