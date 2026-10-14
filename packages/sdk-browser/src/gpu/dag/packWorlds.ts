import { sameMatrixFloat32 } from '../../../../math/src/matrix/matrixElements.ts'
import type { DagRoot } from './types.ts'

/** Each root's world as the cut's worlds hold it — or those of `ranks` alone, the others left —:
 *  its sixteen numbers in single precision, the translation kept exactly beside them
 *  (`worldOrigins.ts`), which each cut reads at its own eye (`shader/worldPoseWgsl.ts`). */
export function rootWorlds(
  worlds: Float32Array,
  roots: readonly DagRoot[],
  ranks?: ArrayLike<number>,
) {
  const count = ranks ? ranks.length : roots.length
  for (let k = 0; k < count; k++) {
    const w = ranks ? ranks[k] : k
    worlds.set(roots[w].world.elements, w * 16)
  }
}

/**
 * The roots whose world is no longer the one `worlds` holds (`rootWorlds`), increasing, listed in
 * `into` — one entry a root at least —: the same single-precision rounding, so a pose the host
 * left alone compares bit for bit, whatever the eye. Nothing is written.
 */
export function rootWorldsMoved(worlds: Float32Array, roots: readonly DagRoot[], into: Int32Array) {
  let count = 0
  for (let w = 0; w < roots.length; w++)
    if (!sameMatrixFloat32(worlds, roots[w].world.elements, w * 16)) into[count++] = w
  return into.subarray(0, count)
}
