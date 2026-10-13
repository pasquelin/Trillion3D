import {
  PROXY_NODE_FLOATS,
  PROXY_NODE_WORDS,
  PROXY_TRIANGLE_FLOATS,
} from '../../../../sdk-core/src/index.ts'
import type { RuntimeCutProxy } from '../../../../sdk-core/src/contracts/proxy.ts'
import type { DrawnDeformation } from '../../../../sdk-core/src/world/geometry/drawnDeformation.ts'
import { cornerDeformation } from './runtimeDeform.ts'
import { reserveArena, takeHeld } from '../../wasm/wasmArena.ts'
import type { SdkWasm } from '../../wasm/sdkWasm.ts'

/** Words of the answer block of `proxy_build` (`page-codec-wasm/src/wasm_proxy.rs`): the triangle
 *  count, the node count, the grid step's bits. */
const META_WORDS = 4

/**
 * The proxy of a cut, in the cut's own space, by the builder the compiler's resident proxy goes
 * through (`proxy.rs`, `cut_columns`): `indices` over `positions` are snapped to the finest grid
 * that leaves a bounded count of triangles, a BVH is built over them and collapsed to wide nodes.
 * Run where the cut runs (`runtimeCut.ts`), the page worker's; the columns come back owned. A cut that
 * deforms (`deformation`) brings what poses its corners (`runtimeDeform.ts`).
 */
export function buildCutProxy(
  module: SdkWasm,
  indices: Uint32Array,
  positions: Float32Array,
  deformation?: DrawnDeformation,
): RuntimeCutProxy {
  const input = reserveArena(module, [
    { type: 'u32', length: indices.length },
    { type: 'f32', length: positions.length },
    { type: 'u32', length: META_WORDS },
  ])
  if (!input) throw new Error('PROXY_BUILDER_MEMORY')
  let triangles: number, nodes: number, cell: number
  try {
    const [index, position] = input.blocks()
    index.view.set(indices)
    position.view.set(positions)
    const status = module.proxy_build(
      index.offset,
      indices.length,
      position.offset,
      positions.length / 3,
      input.blocks()[2].offset,
    )
    if (status !== 0) throw new Error('PROXY_BUILDER_REFUSED')
    const answer = input.blocks()[2].view as Uint32Array
    triangles = answer[0]
    nodes = answer[1]
    cell = new Float32Array(answer.buffer, answer.byteOffset + 8, 1)[0]
  } finally {
    input.freed()
  }
  // The held columns (`CutColumns::column_words`), four bytes a number, each its own buffer.
  const [triangleBytes, albedo, boundBytes, children, sources] = takeHeld(
    module,
    [
      triangles * PROXY_TRIANGLE_FLOATS,
      triangles,
      nodes * PROXY_NODE_FLOATS,
      nodes * PROXY_NODE_WORDS,
      triangles,
    ].map((count) => count * 4),
  )
  const deform = deformation && cornerDeformation(new Uint32Array(sources), indices, deformation)
  return {
    triangles: new Float32Array(triangleBytes),
    albedo: new Uint32Array(albedo),
    nodeBounds: new Float32Array(boundBytes),
    nodeChildren: new Uint32Array(children),
    cellMetres: cell,
    ...(deform ? { deform } : {}),
  }
}
