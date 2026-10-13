import { MAX_LEVELS } from '../../texture/tiles.ts'
import { entryPlace, placeIndex } from '../../texture/tiles.fixture.ts'
import { PAGE_HEADER_WORDS, PAGE_SLOT_WORDS } from './pageTable.ts'

// CPU mirrors of the feedback stamp (`stampWgsl.ts`) and of the reduction that calls it
// (`reduceWgsl.ts`), on the words the kernels read.

/** `tileEntryIndex`: the pool index of the place a served entry names. */
export const entryIndex = (word: number) => placeIndex(entryPlace(word))

/** `${k}StampUse` of table `words`: the lane and pool index a pixel asking `entry` reads — none
 *  for the tail. */
export function stampedPlace(words: Uint32Array, entry: number) {
  const at = words[2] + entry,
    slots = words[1]
  if (slots === 0 || at >= words.length || words[at] === 0) return undefined
  let lo = 0,
    hi = slots
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1
    if (words[words[3] + mid * MAX_LEVELS] <= at) lo = mid
    else hi = mid
  }
  const lane = Math.min(words[PAGE_HEADER_WORDS + lo * PAGE_SLOT_WORDS + 3] >>> 24, 2)
  return { lane, index: entryIndex(words[at]) }
}

/** `reduce` over one image's requests (a rank plus one, 0 none), pixel after pixel: the first
 *  count of a rank stamps it (`stamp`), then lists it under `cap`, else zeroes its counter. */
export function reduceRequests(
  requests: readonly number[],
  cap: number,
  stamp: (rank: number) => void,
) {
  const counts = new Map<number, number>(),
    listed: number[] = []
  for (const request of requests) {
    if (request === 0) continue
    const rank = request - 1,
      before = counts.get(rank) ?? 0
    counts.set(rank, before + 1)
    if (before !== 0) continue
    stamp(rank)
    if (listed.length < cap) listed.push(rank)
    else counts.set(rank, 0)
  }
  return listed
}
