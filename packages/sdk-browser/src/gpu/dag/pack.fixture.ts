import { worldToRenderOrigin } from '../../../../sdk-core/src/index.ts'
import { rootWorlds } from './pack.ts'
import type { PackedDag, DagRoot } from './types.ts'

/** Each root's world brought to `origin` in single precision, the double subtraction first: what
 *  the GPU's rebase leaves in the cut's worlds (`worldRebase.ts`), word for word. */
export function rootWorldsToRenderOrigin(
  worlds: Float32Array,
  roots: readonly DagRoot[],
  origin: ArrayLike<number>,
) {
  for (let w = 0; w < roots.length; w++)
    worldToRenderOrigin(worlds, roots[w].world.elements, origin, w * 16)
}

/**
 * Brings packed world matrices into the RENDER FRAME whose origin is `origin` —
 * the frame's eye (`../../../../math/src/projection/renderOrigin.ts`). `packDagSelection` returns them
 * in absolute world: the engine's GPU rebase brings them to the eye before the cut reads them
 * (`worldRebase.ts`), and this is how a kernel caller without the engine — oracle, bench, test
 * mount — enters the frame of the uniforms it builds. Root matrices, in double,
 * are the source: subtraction precedes rounding.
 */
export function packedWorldsToRenderOrigin(
  packed: PackedDag,
  roots: readonly DagRoot[],
  origin: ArrayLike<number>,
) {
  rootWorldsToRenderOrigin(packed.worlds, roots, origin)
  return packed
}

/** Every page's url of `dag`, in page order: what a test compares a cut's ids against. */
export const dagPageUrls = (dag: PackedDag) =>
  Array.from({ length: dag.pageCount }, (_, page) => dag.pageUrlOf(page)!)

/** Moves placement `w` to `x` on its first axis, as a host pose does: its world, then the worlds
 *  the engine sends the cut (`rootWorlds`), its exact translation read again behind them. */
export function moveRoot(dag: PackedDag, w: number, x: number) {
  const roots = dag.worldSources as readonly DagRoot[]
  ;(roots[w].world.elements as number[])[12] = x
  const worlds = new Float32Array(dag.worlds.length)
  rootWorlds(worlds, roots)
  return worlds
}
