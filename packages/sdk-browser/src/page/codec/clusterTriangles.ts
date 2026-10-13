import {
  DAG_CLUSTER_TRIANGLES,
  DAG_CLUSTER_VERTICES,
} from '../../../../sdk-core/src/page/format.ts'
import {
  CLUSTER_ORDERED,
  CLUSTER_ORDERED_COMPACT,
  CLUSTER_SPATIAL,
} from '../../../../sdk-core/src/contracts/writtenFormats.ts'
import { reserveArena, takeHeld } from '../../wasm/wasmArena.ts'
import type { SdkWasm } from '../../wasm/sdkWasm.ts'

/** The rules of `cluster_build` (`page-codec-wasm/src/wasm_clusters.rs`): `spatial`, compact
 *  patches in any index order; `ordered`, consecutive triangles in their source order;
 *  `compact`, ordered runs that stop where they would reach past a compact cluster. */
const CLUSTER_RULES = {
  spatial: CLUSTER_SPATIAL,
  ordered: CLUSTER_ORDERED,
  compact: CLUSTER_ORDERED_COMPACT,
} as const
export type ClusterRule = keyof typeof CLUSTER_RULES

/**
 * THE CLUSTERS of `indices` over `positions`, by the clusterer the compiler's DAG goes through
 * (`page-codec-wasm/src/clusters.rs`) in the SDK module, each within the format's caps
 * (`DAG_CLUSTER_TRIANGLES`, `DAG_CLUSTER_VERTICES`): the indices in cluster order — the source's
 * own for an ordered rule — and the index range of each cluster. Run where the cut runs
 * (`../../world/page/runtimeCut.ts`), the page worker's.
 */
export function clusterTriangles(
  module: SdkWasm,
  indices: Uint32Array,
  positions: Float32Array,
  rule: ClusterRule,
): { indices: Uint32Array; ranges: [number, number][] } {
  const input = reserveArena(module, [
    { type: 'u32', length: Math.max(1, indices.length) },
    { type: 'f32', length: Math.max(1, positions.length) },
    { type: 'u32', length: 2 },
    { type: 'u32', length: 1 },
  ])
  if (!input) throw new Error('CLUSTER_BUILDER_MEMORY')
  let count: number
  try {
    const [index, position, caps, meta] = input.blocks()
    index.view.set(indices)
    position.view.set(positions)
    caps.view.set([DAG_CLUSTER_TRIANGLES, DAG_CLUSTER_VERTICES])
    const status = module.cluster_build(
      ...[index.offset, indices.length, position.offset, positions.length / 3],
      ...[CLUSTER_RULES[rule], caps.offset, meta.offset],
    )
    if (status !== 0) throw new Error('CLUSTER_BUILDER_REFUSED')
    count = input.blocks()[3].view[0]
  } finally {
    input.freed()
  }
  // The held answer: the indices in cluster order, then where each of the `count` clusters ends.
  const [ordered, built] = takeHeld(module, [module.held_length() - count * 4, count * 4])
  const ends = new Uint32Array(built)
  return {
    indices: new Uint32Array(ordered),
    ranges: Array.from(ends, (end, k): [number, number] => [k ? ends[k - 1] : 0, end]),
  }
}
