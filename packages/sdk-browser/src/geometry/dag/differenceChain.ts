import type { CutClaims } from '../../gpu/core/selection.ts'
import { countWord, differenceWord } from './readoutWords.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'

/** What the host holds of the readbacks the chain follows: no GPU list, the readback in hand, or
 *  an older one the claims name ranks in. */
const HOLDS_NONE = 0,
  HOLDS_LAST = 1,
  HOLDS_CLAIMED = 2

/** `count` ranks at word `at` of `ints` into `out`, carried through `via` — the ranks since the last
 *  readback the host adopted — when a readback the host may not adopt came between, then through
 *  `through` unless it is absent. */
function carry(
  out: Uint32Array,
  ints: Uint32Array,
  at: number,
  count: number,
  via: Uint32Array | null,
  through: Uint32Array | null,
) {
  if (!via && !through) return out.set(ints.subarray(at, at + count))
  for (let s = 0; s < count; s++) {
    let r = ints[at + s]
    if (r !== NO_INDEX && via) r = via[r]
    out[s] = r === NO_INDEX || !through ? r : through[r]
  }
}

/** The first page of each of the `count` requests read at word `at` of `ints`, and the pages in all
 *  behind them, in `starts` (grown when it is short; returned). */
function startsOf(starts: Uint32Array<ArrayBuffer>, ints: Uint32Array, at: number, count: number) {
  starts = resized(starts, count + 1)
  let pages = 0
  for (let r = 0; r < count; r++) {
    starts[r] = pages
    pages += ints[at + r]
  }
  starts[count] = pages
  return starts
}

/** The camera's claims by request, `by` — `count` of them —, as pages in `claims.asked`: each
 *  request's pages claim those of the request it claims in the list the host holds (`heldStarts`,
 *  `held` requests: the buffer may be longer), page for page, none when the claim lies past that
 *  list. */
function claimPages(
  claims: CutClaims,
  by: Uint32Array,
  starts: Uint32Array,
  heldStarts: Uint32Array,
  count: number,
  held: number,
) {
  const total = starts[count]
  claims.asked = resized(claims.asked, total)
  for (let r = 0; r < count; r++) {
    const first = starts[r],
      pages = starts[r + 1] - first,
      claim = by[r]
    if (claim < held) {
      const from = heldStarts[claim]
      for (let k = 0; k < pages; k++) claims.asked[first + k] = from + k
    } else claims.asked.fill(NO_INDEX, first, first + pages)
  }
}

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
 * its mark as it finds an entry (`../cut/adoption/claimedDifference.ts`); a claim is proven there
 * before it is believed, so a list the host wrote itself since costs lookups, never a wrong page.
 * Each landing costs one pass over each list — a plain copy while the host adopts every readback —,
 * in buffers grown to the longest list seen: two a list for the claims, two for `since`.
 *
 * The camera's list holds one rank a REQUEST — a leaf's pages, `request/request.ts` —, the host's
 * one a page: the ranks of that list are carried request by request, and the claims handed to the
 * host name pages, each request's pages from the first page of the request it claims in the list
 * the host holds (`starts`, the first page of each request of a readback in the pages it names).
 */
export function createDifferenceChain() {
  const claims: CutClaims = { asked: new Uint32Array(0), drawn: new Uint32Array(0) }
  /** Each list's claims by rank — the camera's by request — and the buffer the next ones are
   *  written into, then swapped; `claims.drawn` is the second list's. */
  const ranks: Uint32Array[] = [new Uint32Array(0), new Uint32Array(0)]
  const spare: Uint32Array[] = [new Uint32Array(0), new Uint32Array(0)]
  let since: Uint32Array[] = [new Uint32Array(0), new Uint32Array(0)],
    sinceSpare: Uint32Array[] = [new Uint32Array(0), new Uint32Array(0)]
  /** The first page of each request, and the pages in all behind them, of the readback in hand and
   *  of the one the host holds, and how many requests each has (the buffers may be longer). */
  let starts = new Uint32Array(1),
    heldStarts = new Uint32Array(1),
    inHand = 0,
    heldRequests = 0
  /** Whether the last readback landed was not adoptable, and what the host holds. */
  let sinceLast = false,
    holds = HOLDS_NONE
  return {
    /** Lands a readback, `ints` its mapped words, cut on a list of `listCap` ranks with `asked` and
     *  `drawn` ranks in its lists; `adoptable` when it becomes the readback in hand. */
    land(ints: Uint32Array, listCap: number, asked: number, drawn: number, adoptable: boolean) {
      const at = differenceWord(listCap)
      for (let l = 0; l < 2; l++) {
        const count = Math.min(l ? drawn : asked, listCap),
          from = at + l * listCap,
          via = sinceLast ? since[l] : null
        if (!adoptable) {
          if (sinceSpare[l].length < count) sinceSpare[l] = resized(sinceSpare[l], count)
          carry(sinceSpare[l], ints, from, count, via, null)
        } else if (holds !== HOLDS_NONE) {
          if (spare[l].length < count) spare[l] = resized(spare[l], count)
          const last = ranks[l]
          carry(spare[l], ints, from, count, via, holds === HOLDS_CLAIMED ? last : null)
          ranks[l] = spare[l]
          spare[l] = last
        }
      }
      if (adoptable) {
        inHand = Math.min(asked, listCap)
        starts = startsOf(starts, ints, countWord(listCap), inHand)
        if (holds !== HOLDS_NONE) {
          claimPages(claims, ranks[0], starts, heldStarts, inHand, heldRequests)
          claims.drawn = ranks[1]
        }
      } else [since, sinceSpare] = [sinceSpare, since]
      if (adoptable && holds === HOLDS_LAST) holds = HOLDS_CLAIMED
      sinceLast = !adoptable
    },
    /** The host adopts the readback in hand: its claims, valid until the next landing, or none
     *  when the host held no GPU list. */
    adopt() {
      const held = holds
      holds = HOLDS_LAST
      ;[heldStarts, starts] = [starts, heldStarts]
      heldRequests = inHand
      return held === HOLDS_NONE ? undefined : claims
    },
  }
}
