// The culling hierarchy a fixture's root descends, by the one builder every cache and cut goes
// through (`page-codec-wasm/src/culling.rs`, in the SDK module): its pages ranked in its order, as
// the compiler and the run-time cut rank theirs.
import { buildCullingHierarchy, type CullingInput } from '../../page/codec/cullingHierarchy.ts'
import { sdkWasm } from '../../wasm/sdkWasm.fixture.ts'

/** `pages` ranked IN PLACE in the order of the hierarchy the one builder gives them, and that
 *  hierarchy as a root reads it. A fixture whose pages name one another by rank ranks them first. */
export function cullingInPlace<P extends CullingInput>(pages: P[]) {
  const { order, culling } = buildCullingHierarchy(sdkWasm, pages)
  const ranked = Array.from(order, (k) => pages[k])
  // Copied rank by rank: a spread of a million pages would pass the call stack's bound.
  ranked.forEach((page, at) => (pages[at] = page))
  return { nodes: Float64Array.from(culling.nodes), stride: culling.stride }
}

/** The hierarchy the compiler writes beside a fixture primitive's `pages`, which the fixture lays
 *  in the order the builder gives them already (by level, then in space): a fixture out of that
 *  order is refused, its ranks would not be the cook's. */
export function manifestCulling(pages: readonly CullingInput[]) {
  const { order, culling } = buildCullingHierarchy(sdkWasm, pages)
  if (order.some((k, at) => k !== at))
    throw new Error(`fixture pages out of their culling order: ${Array.from(order)}`)
  return culling
}
