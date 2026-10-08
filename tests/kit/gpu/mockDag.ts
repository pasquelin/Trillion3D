import type { PackedDag } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { DAG_BINDING } from '../../../packages/sdk-browser/src/gpu/dag/shader/bindings.ts'
import { primitiveWordAt } from '../../../packages/sdk-browser/src/gpu/dag/worlds.ts'
import { viewWord } from '../../../packages/sdk-browser/src/gpu/dag/viewLayout.ts'
import { floats, words } from './mockBuffers.ts'
import { worldsAtEye } from './mockWorldPose.ts'

type Bound = Map<number, { data: Uint8Array }>

/** The DAG selection uniform block as the shader reads it: the camera. */
export function readDagUniforms(data: Uint8Array) {
  const f32 = floats(data),
    u32 = words(data)
  const at = viewWord,
    camera = at('cameraWorld'),
    scale = at('pixelScale')
  return {
    uniforms: {
      planes: f32.slice(at('planes'), at('planes') + 24),
      view: f32.slice(at('view'), at('view') + 16),
      pixelScale: [f32[scale], f32[scale + 1]] as [number, number],
      pixelError: f32[at('pixelError')],
      near: f32[at('near')],
      cameraWorld: [f32[camera], f32[camera + 1], f32[camera + 2]] as [number, number, number],
      cameraStretch: f32[at('cameraStretch')],
      admitByLevel: !!u32[at('admitByLevel')],
    },
  }
}

/** The list cap the kernels read, from the camera's uniform block (`listCap.ts`). */
export const boundListCap = (byBinding: Bound) =>
  words(byBinding.get(DAG_BINDING.views)!.data)[viewWord('listCap')]

/**
 * The DAG a cut's bound buffers hold, for a device no test handed one (`mockGpu({ packed })`):
 * the tables as the host uploaded them, the counts as the camera's uniform block carries them, and
 * each primitive's words as its frame row holds them (`primitiveFrameWords`). What the kernels'
 * CPU doubles read of a packing, and nothing more: the GPU cut is the engine's one cut (#1483), so
 * every session on the double runs it.
 */
export function packedFromBindings(byBinding: Bound): PackedDag {
  const views = words(byBinding.get(DAG_BINDING.views)!.data)
  const pageCount = views[viewWord('clusterCount')],
    nodeCount = views[viewWord('nodeCount')],
    worldCount = views[viewWord('worldCount')]
  const frameBytes = byBinding.get(DAG_BINDING.frames)!.data,
    frameInts = words(frameBytes),
    frameFloats = floats(frameBytes)
  /** Word `at` of each primitive's frame row, read as floats or as integers. */
  const floatsAt = (at: number) =>
    Float32Array.from({ length: worldCount }, (_, w) => frameFloats[primitiveWordAt(w) + at])
  const intsAt = (at: number) =>
    Uint32Array.from({ length: worldCount }, (_, w) => frameInts[primitiveWordAt(w) + at])
  const rootNodes = intsAt(1)
  return {
    kind: 'dag',
    clusters: floats(byBinding.get(DAG_BINDING.clusters)!.data),
    nodes: floats(byBinding.get(DAG_BINDING.nodes)!.data),
    pageCones: floats(byBinding.get(DAG_BINDING.cold)!.data),
    worlds: worldsAtEye(
      byBinding.get(DAG_BINDING.worlds)!.data,
      byBinding.get(DAG_BINDING.views)!.data,
      worldCount * 16,
    ),
    worldStretch: floatsAt(0),
    rootNodes,
    rootBases: rootNodes.slice(),
    recordShift: intsAt(2),
    mark: intsAt(3),
    levelSizes: new Uint32Array(0),
    nodeCount,
    worldCount,
    pageCount,
    recordCount: 0,
    rootCount: worldCount,
    pageUrlOf: () => undefined,
    cutLinks: [],
  }
}
