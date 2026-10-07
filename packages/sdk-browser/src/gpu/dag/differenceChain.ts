import { SELECTION_NONE as NONE, type CutClaims } from '../core/selection.ts'
import { differenceWord } from './layout.ts'
import { grown } from '../../page/cut/sparseInts.ts'

/** What the host holds of the readbacks the chain follows: no GPU list, the readback in hand, or
 *  an older one the claims name ranks in. */
const HOLDS_NONE = 0,
  HOLDS_LAST = 1,
  HOLDS_CLAIMED = 2

/**
 * EVERY COPIED SNAPSHOT, followed to the list the host holds.
 *
 * The GPU takes each copy's difference against the copy before it (`shader/differenceWgsl.ts`):
 * for each rank, the rank its page held there. The host adopts only some copies — another lands
 * before it adopts one, a residency that moved voids one in flight, a truncated one grows the list
 * — and it holds the list of the last it adopted, not of the last copied. Each readback lands here
 * in the order it was copied, and its ranks are carried at once through the snapshots since the one
 * the host holds, so the readback in hand always names its pages by the ranks of that list:
 *
 * - an adoptable readback's claims are its ranks carried through the voided ones since the last
 *   adoptable (`since`), then through that one's claims — or kept as they are when the host adopted
 *   that one;
 * - a readback the host may not adopt only extends `since`;
 * - before the host adopts a readback there is nothing to claim in: the lists it holds — the
 *   bootstrap's — were never a GPU snapshot.
 *
 * A page that left a snapshot in between and came back is claimed by none, and the host finds it by
 * its mark as it finds an entry (`../../webgpu/cut/claimedDifference.ts`); a claim is proven there
 * before it is believed, so a list the host wrote itself since costs lookups, never a wrong page.
 * Each landing costs one pass over each list — a plain copy while the host adopts every readback —,
 * in buffers grown to the longest list seen: two a list for the claims, two for `since`.
 */
export function createDifferenceChain() {
  const claims: CutClaims = { asked: new Uint32Array(0), drawn: new Uint32Array(0) }
  /** Buffers the next claims and the next `since` of each list are written into, then swapped. */
  const spare: Uint32Array[] = [new Uint32Array(0), new Uint32Array(0)]
  let since: Uint32Array[] = [new Uint32Array(0), new Uint32Array(0)],
    sinceSpare: Uint32Array[] = [new Uint32Array(0), new Uint32Array(0)]
  /** Whether the last readback landed was not adoptable, and what the host holds. */
  let sinceLast = false,
    holds = HOLDS_NONE
  /** List `l`'s `count` ranks at word `at` of `ints` into `out`, carried through `since` when a
   *  readback the host may not adopt came between, then through `through` unless it is absent. */
  const carry = (
    out: Uint32Array,
    ints: Uint32Array,
    at: number,
    count: number,
    l: number,
    through: Uint32Array | null,
  ) => {
    if (!sinceLast && !through) return out.set(ints.subarray(at, at + count))
    const via = since[l]
    for (let s = 0; s < count; s++) {
      let r = ints[at + s]
      if (r !== NONE && sinceLast) r = via[r]
      out[s] = r === NONE || !through ? r : through[r]
    }
  }
  return {
    /** Lands a readback, `ints` its mapped words, cut on a list of `listCap` ranks with `asked` and
     *  `drawn` ranks in its lists; `adoptable` when it becomes the readback in hand. */
    land(ints: Uint32Array, listCap: number, asked: number, drawn: number, adoptable: boolean) {
      const at = differenceWord(listCap)
      for (let l = 0; l < 2; l++) {
        const count = Math.min(l ? drawn : asked, listCap),
          from = at + l * listCap
        if (!adoptable) {
          if (sinceSpare[l].length < count) sinceSpare[l] = grown(sinceSpare[l], count)
          carry(sinceSpare[l], ints, from, count, l, null)
        } else if (holds !== HOLDS_NONE) {
          if (spare[l].length < count) spare[l] = grown(spare[l], count)
          const last = l ? claims.drawn : claims.asked
          carry(spare[l], ints, from, count, l, holds === HOLDS_CLAIMED ? last : null)
          if (l) claims.drawn = spare[l]
          else claims.asked = spare[l]
          spare[l] = last
        }
      }
      if (!adoptable) [since, sinceSpare] = [sinceSpare, since]
      if (adoptable && holds === HOLDS_LAST) holds = HOLDS_CLAIMED
      sinceLast = !adoptable
    },
    /** The host adopts the readback in hand: its claims, valid until the next landing, or none
     *  when the host held no GPU list. */
    adopt() {
      const held = holds
      holds = HOLDS_LAST
      return held === HOLDS_NONE ? undefined : claims
    },
  }
}
