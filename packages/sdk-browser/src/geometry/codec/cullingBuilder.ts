import type { CullingHierarchy } from '../../../../sdk-core/src/contracts/geometry.ts'
import {
  CULLING_RECORD_FLOATS,
  CULLING_STRIDE,
} from '../../../../sdk-core/src/contracts/writtenFormats.ts'
import { takeHeld, withArena } from '../../wasm/wasmArena.ts'
import type { SdkWasm } from '../../wasm/sdkWasm.ts'

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
