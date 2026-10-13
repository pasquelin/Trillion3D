import type { CullingHierarchy } from '../../../../sdk-core/src/index.ts'
import { reserveArena } from '../../wasm/wasmArena.ts'
import type { SdkWasm } from '../../wasm/sdkWasm.ts'

/** Numbers per node of the hierarchy (`page-codec-wasm/src/culling.rs`, `CULLING_STRIDE`). */
const STRIDE = 15
/** Numbers per cluster record `culling_build` reads (`wasm_culling.rs`, `CULLING_RECORD_FLOATS`). */
const RECORD = 12

/** One cluster as the hierarchy builder takes it: its box, and for a cluster something replaces,
 *  its level and the band of that replacement; a root, which nothing replaces, has none. */
export type CullingInput = {
  min: ArrayLike<number>
  max: ArrayLike<number>
  level?: number
  parentSphere?: ArrayLike<number> | null
  parentError?: number | null
}

/**
 * THE CULLING HIERARCHY of `clusters`, by the builder the compiler's primitives and world go through
 * (`page-codec-wasm/src/culling.rs`, `build_culling_bvh`), in the SDK module: the root splits by
 * level, every node by three median splits of its clusters' centres, down to leaves of eight. Its
 * `order` names, rank by rank, the cluster each page must hold so that every node owns a contiguous
 * page range; its nodes, in the manifest's layout, name pages by those ranks. Run where the cut
 * runs (`../../world/page/runtimeCut.ts`), the page worker's.
 */
export function buildCullingHierarchy(
  module: SdkWasm,
  clusters: readonly CullingInput[],
): { order: Uint32Array; culling: CullingHierarchy } {
  const count = clusters.length
  const input = reserveArena(module, [
    { type: 'f64', length: Math.max(1, count * RECORD) },
    { type: 'u32', length: 1 },
  ])
  if (!input) throw new Error('CULLING_BUILDER_MEMORY')
  let nodes: number
  try {
    const [records] = input.blocks()
    clusters.forEach((cluster, k) => {
      const at = k * RECORD,
        root = cluster.parentError === null || cluster.parentError === undefined,
        band = cluster.parentSphere
      records.view.set(cluster.min as ArrayLike<number>, at)
      records.view.set(cluster.max as ArrayLike<number>, at + 3)
      for (let a = 0; a < 4; a++) records.view[at + 6 + a] = band ? band[a] : 0
      records.view[at + 10] = root ? Infinity : (cluster.parentError as number)
      records.view[at + 11] = cluster.level ?? 0
    })
    const status = module.culling_build(records.offset, count, input.blocks()[1].offset)
    if (status !== 0) throw new Error('CULLING_BUILDER_REFUSED')
    nodes = input.blocks()[1].view[0]
  } finally {
    input.freed()
  }
  const out = reserveArena(module, [
    { type: 'f64', length: Math.max(1, nodes * STRIDE) },
    { type: 'u32', length: Math.max(1, count) },
  ])
  if (!out) throw new Error('CULLING_BUILDER_MEMORY')
  try {
    const [nodeBlock, orderBlock] = out.blocks()
    module.culling_build_take(nodeBlock.offset, orderBlock.offset)
    const [flat, ranks] = out.blocks()
    return {
      order: Uint32Array.from(ranks.view.subarray(0, count)),
      culling: {
        stride: STRIDE,
        count: nodes,
        nodes: Array.from(flat.view.subarray(0, nodes * STRIDE)),
      },
    }
  } finally {
    out.freed()
  }
}
