import { rootWorldsToRenderOrigin } from './pack.ts'
import type { PackedDag, DagRoot } from './types.ts'

/**
 * Brings packed world matrices into the RENDER FRAME whose origin is `origin` —
 * the frame's eye (`../../../../sdk-core/src/math/primitives/renderOrigin.ts`). `packDagSelection` returns them
 * in absolute world: the engine rebases them per frame before sending them to the
 * GPU, and this is how a kernel caller without the engine — oracle, bench, test
 * mount — enters the frame of the uniforms it builds. Root matrices, in double,
 * are the source: subtraction precedes rounding.
 */
export function packedWorldsToRenderOrigin(
  packed: PackedDag,
  roots: readonly DagRoot[],
  origin: ArrayLike<number>,
) {
  rootWorldsToRenderOrigin(packed.worlds, roots, origin, new Float64Array(roots.length * 3))
  return packed
}

/** Every page's url of `dag`, in page order: what a test compares a cut's ids against. */
export const dagPageUrls = (dag: PackedDag) =>
  Array.from({ length: dag.pageCount }, (_, page) => dag.pageUrlOf(page)!)
