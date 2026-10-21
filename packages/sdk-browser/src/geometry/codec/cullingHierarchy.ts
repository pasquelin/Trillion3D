import type { CullingHierarchy } from '../../../../sdk-core/src/contracts/geometry.ts'
import {
  CULLING_RECORD_FLOATS,
  CULLING_STRIDE,
} from '../../../../sdk-core/src/contracts/writtenFormats.ts'
import { takeHeld, withArena } from '../../wasm/wasmArena.ts'
import type { SdkWasm } from '../../wasm/sdkWasm.ts'

/** One cluster as the hierarchy builder takes it, a group part of its own: its box, its own ball
 *  and error, and for a cluster something replaces, its level and the band of that replacement; a
 *  root, which nothing replaces, has none, its own ball its LOD ball. */
export type CullingInput = {
  min: ArrayLike<number>
  max: ArrayLike<number>
  level?: number
  sphere?: ArrayLike<number> | null
  lodError?: number | null
  parentSphere?: ArrayLike<number> | null
  parentError?: number | null
}

/**
 * THE CULLING HIERARCHY of the group parts `records` hold, `count` records of
 * `CULLING_RECORD_FLOATS` numbers — box, LOD ball, least own error, replacement error (infinite
 * for a root), level, first rank and count (`page-codec-wasm/src/culling/layout.rs`) —, by the
 * builder the compiler's primitives and world go through (`page-codec-wasm/src/culling.rs`,
 * `build_culling_bvh`), in the SDK module: one tree per level of four children a node, its parts
 * sorted along the axis of least cost, the levels' roots under one root. Its nodes, in the
 * manifest's layout, name pages by the parts' ranks.
 */
export function cullingOfParts(
  module: SdkWasm,
  count: number,
  records: (view: Float64Array) => void,
): CullingHierarchy {
  const nodes = withArena(
    module,
    [
      { type: 'f64', length: Math.max(1, count * CULLING_RECORD_FLOATS) },
      { type: 'u32', length: 1 },
    ],
    'CULLING_BUILDER_MEMORY',
    (input) => {
      const [held, meta] = input.blocks()
      // The first block is the `f64` one requested above.
      records(held.view as Float64Array)
      const status = module.culling_build(held.offset, count, meta.offset)
      if (status !== 0) throw new Error('CULLING_BUILDER_REFUSED')
      // Read through `blocks()` again: the build may have grown the memory and detached `meta.view`.
      return input.blocks()[1].view[0]
    },
  )
  // The held answer: the nodes, `CULLING_STRIDE` doubles each.
  const [flat] = takeHeld(module, [nodes * CULLING_STRIDE * 8])
  return { stride: CULLING_STRIDE, count: nodes, nodes: Array.from(new Float64Array(flat)) }
}

/**
 * THE CULLING HIERARCHY of `clusters` (`cullingOfParts`), each cluster a part of its own at its
 * rank — no group and no streaming page joins two here —, its LOD ball the band of what replaces
 * it, its own ball for a root. Run where the cut runs (`../runtime/runtimeCut.ts`), the page
 * worker's.
 */
export const buildCullingHierarchy = (module: SdkWasm, clusters: readonly CullingInput[]) =>
  cullingOfParts(module, clusters.length, (view) =>
    clusters.forEach((cluster, k) => {
      const at = k * CULLING_RECORD_FLOATS,
        root = cluster.parentError === null || cluster.parentError === undefined,
        ball = (root ? cluster.sphere : cluster.parentSphere) ?? cluster.sphere
      view.set(cluster.min as ArrayLike<number>, at)
      view.set(cluster.max as ArrayLike<number>, at + 3)
      for (let a = 0; a < 4; a++) view[at + 6 + a] = ball ? ball[a] : 0
      view[at + 10] = cluster.lodError ?? 0
      view[at + 11] = root ? Infinity : (cluster.parentError as number)
      view[at + 12] = cluster.level ?? 0
      view[at + 13] = k
      view[at + 14] = 1
    }),
  )
