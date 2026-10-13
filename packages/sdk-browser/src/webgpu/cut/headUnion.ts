import { resized } from '../../../../math/src/sequence/resized.ts'
import { createSparseInts } from '../../page/cut/sparseInts.ts'

/**
 * A TRUNCATED READOUT NAMES NO EXIT. A list still past the device at the coarsest cut — its roots
 * and cells alone (`../../gpu/dag/coarsening.ts`) — is read by its head: the frame's
 * mask draws the whole cut, so a page past the head has not left it, and must not leave the sets
 * the residency keeps and evicts from. Such a list is
 * published as its head, then every page the list held before that the head does not name, in the
 * held order: entries only. The head keeps its ranks, so the claims of the next readbacks, which
 * name ranks of the GPU list, still find their pages (`./claimedDifference.ts`).
 *
 * The head's pages marked in a sparse map (`../../page/cut/sparseInts.ts`) emptied after each list,
 * so its size follows the head, never the largest page id; nothing is held on a whole list.
 */
export function createHeadUnion() {
  const marks = createSparseInts()
  let out = new Int32Array(0)
  return (head: ArrayLike<number>, held: ArrayLike<number>, heldCount: number) => {
    const count = head.length + heldCount
    if (out.length < count) out = resized(out, count)
    let n = 0
    for (let i = 0; i < head.length; i++) {
      marks.set(head[i], 1)
      out[n++] = head[i]
    }
    for (let i = 0; i < heldCount; i++) if (!marks.has(held[i])) out[n++] = held[i]
    marks.clear()
    return out.subarray(0, n)
  }
}
