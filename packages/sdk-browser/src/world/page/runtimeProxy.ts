import {
  PROXY_NODE_FLOATS,
  PROXY_NODE_WORDS,
  PROXY_TRIANGLE_FLOATS,
} from '../../../../sdk-core/src/index.ts'
import type { PageCutProxy } from '../../../../sdk-core/src/page/taskContracts.ts'
import { reserveArena } from '../../wasm/wasmArena.ts'
import type { SdkWasm } from '../../wasm/sdkWasm.ts'

/** Words of the answer block of `proxy_build` (`page-codec-wasm/src/wasm_proxy.rs`): the triangle
 *  count, the node count, the grid step's bits. */
const META_WORDS = 4

/**
 * The proxy of a cut, in the cut's own space, by the builder the compiler's resident proxy goes
 * through (`proxy.rs`, `cut_columns`): `indices` over `positions` are snapped to the finest grid
 * that leaves a bounded count of triangles, a BVH is built over them and collapsed to wide nodes.
 * Run where the cut runs (`runtimeCut.ts`), the page worker's; the columns come back owned.
 */
export function buildCutProxy(
  module: SdkWasm,
  indices: Uint32Array,
  positions: Float32Array,
): PageCutProxy {
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
  const counts = [
    triangles * PROXY_TRIANGLE_FLOATS,
    triangles,
    nodes * PROXY_NODE_FLOATS,
    nodes * PROXY_NODE_WORDS,
  ]
  const total = counts.reduce((sum, count) => sum + count, 0)
  const out = reserveArena(module, [{ type: 'u32', length: total }])
  if (!out) throw new Error('PROXY_BUILDER_MEMORY')
  try {
    module.proxy_build_take(out.blocks()[0].offset)
    const [{ view }] = out.blocks()
    const words = new Uint32Array(view.buffer, view.byteOffset, total)
    let at = 0
    const take = (count: number) => {
      const part = words.slice(at, at + count)
      at += count
      return part
    }
    const [triangleWords, albedo, boundWords, children] = counts.map(take)
    return {
      triangles: new Float32Array(triangleWords.buffer),
      albedo,
      nodeBounds: new Float32Array(boundWords.buffer),
      nodeChildren: children,
      cellMetres: cell,
    }
  } finally {
    out.freed()
  }
}
