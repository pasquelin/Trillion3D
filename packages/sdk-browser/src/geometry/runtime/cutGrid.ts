import { reserveArena } from '../../wasm/wasmArena.ts'
import type { SdkWasm } from '../../wasm/sdkWasm.ts'

/**
 * The position precision of a primitive the engine cuts at run time into the clusters `ranges`
 * name (into `indices`): the compiler's own rule (`packages/page-codec-wasm/src/bits/grid.rs`), run
 * in the SDK module that encodes the page (`wasm/grid.rs`, `grid_precision`) — each cluster a
 * cluster of the finest level, the mesh's density setting the cells of its pages' grid, lowered as
 * far as the widest cluster needs —, so a page cut here sits on the grid the compiler would give
 * those clusters. Throws `PAGE_ATTRIBUTE_RANGE` when a cluster is too wide for the coarsest one.
 */
export function primitivePrecision(
  module: SdkWasm,
  positions: Float32Array,
  indices: Uint32Array,
  ranges: readonly (readonly [number, number])[],
) {
  const input = reserveArena(module, [
    { type: 'f32', length: Math.max(1, positions.length) },
    { type: 'u32', length: Math.max(1, indices.length) },
    { type: 'u32', length: Math.max(1, ranges.length * 2) },
    { type: 'u32', length: 1 },
  ])
  if (!input) throw new Error('GRID_MEMORY')
  try {
    const [position, index, range, out] = input.blocks()
    position.view.set(positions)
    index.view.set(indices)
    for (let k = 0; k < ranges.length; k++) {
      range.view[k * 2] = ranges[k][0]
      range.view[k * 2 + 1] = ranges[k][1]
    }
    const refused = module.grid_precision(
      position.offset,
      positions.length / 3,
      index.offset,
      range.offset,
      ranges.length,
      out.offset,
    )
    if (refused) throw new Error('PAGE_ATTRIBUTE_RANGE')
    // One signed word, read on a view the call's growth may have rebuilt: the view is unsigned.
    return input.blocks()[3].view[0] | 0
  } finally {
    input.freed()
  }
}
