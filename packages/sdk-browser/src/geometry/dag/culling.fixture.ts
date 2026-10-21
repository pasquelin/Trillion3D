// The culling hierarchy a fixture's root descends, by the one builder every cache and cut goes
// through (`page-codec-wasm/src/culling.rs`, in the SDK module), each page a leaf of its own at its
// rank: the builder moves no page.
import { buildCullingHierarchy, type CullingInput } from '../codec/cullingHierarchy.ts'
import { sdkWasm } from '../../wasm/sdkWasm.fixture.ts'

/** The hierarchy the compiler writes beside a fixture primitive's `pages`, in the manifest's
 *  shape. */
export const manifestCulling = (pages: readonly CullingInput[]) =>
  buildCullingHierarchy(sdkWasm, pages)

/** The hierarchy of `pages` as a root reads it (`manifestCulling`). */
export function cullingInPlace(pages: readonly CullingInput[]) {
  const culling = manifestCulling(pages)
  return { nodes: Float64Array.from(culling.nodes), stride: culling.stride }
}
