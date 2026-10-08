import { resized } from '../../../../math/src/sequence/resized.ts'

/**
 * A TRUNCATED READOUT NAMES NO EXIT (#1483). A list the device could not grow is read by its head
 * (`../../gpu/dag/listCap.ts`): the frame's mask draws the whole cut, so a page past the head has
 * not left it, and must not leave the sets the residency keeps and evicts from. Such a list is
 * published as its head, then every page the list held before that the head does not name, in the
 * held order: entries only. The head keeps its ranks, so the claims of the next readbacks, which
 * name ranks of the GPU list, still find their pages (`./claimedDifference.ts`).
 *
 * Marks by page with an epoch, allocated at the first truncated list: nothing on a whole one.
 */
export function createHeadUnion() {
  let marks = new Int32Array(0),
    out = new Int32Array(0),
    epoch = 0
  return (head: ArrayLike<number>, held: ArrayLike<number>, heldCount: number) => {
    const count = head.length + heldCount
    if (out.length < count) out = resized(out, count)
    epoch++
    let n = 0
    for (let i = 0; i < head.length; i++) {
      const id = head[i]
      if (id >= marks.length) marks = resized(marks, id + 1)
      marks[id] = epoch
      out[n++] = id
    }
    for (let i = 0; i < heldCount; i++) {
      const id = held[i]
      if (id < marks.length && marks[id] === epoch) continue
      out[n++] = id
    }
    return out.subarray(0, n)
  }
}
