import type { PageRec } from '../../page/selection/selection.ts'
import { grown } from '../../page/cut/sparseInts.ts'
import type { createDenseInts } from '../../page/cut/denseInts.ts'

/**
 * A delta as its two differences write it: the held list and its records, the marks, and the
 * buffers the next list is written into. Either difference writes the next ids into `next`, the
 * entries and exits and their counts, the raw sequence into `published`, and returns the next count;
 * the delta then makes `next` the held list.
 */
export type HeldList = {
  /** A packed rank back to its record: the one catalogue accessor. */
  readonly recordOf: (id: number) => PageRec | undefined
  /** Epoch of the list where the id was last held: an id the held list holds carries `epoch`, an
   *  id it does not hold carries nothing. */
  readonly mark: ReturnType<typeof createDenseInts>
  /** The records, rank by rank beside the held ids, when the caller keeps them. */
  readonly pages: PageRec[] | undefined
  epoch: number
  ids: Int32Array
  count: number
  next: Int32Array
  /** The id sequence the last list published, raw — repeats and ids without a record included. */
  published: Int32Array
  publishedCount: number
  /** When the held list skipped ids of its raw sequence, the held rank of each raw rank — none for
   *  a skipped one — and `rawToHeld` true; the GPU's claims name raw ranks. */
  rawRank: Uint32Array
  rawToHeld: boolean
  entered: Int32Array
  enteredCount: number
  exited: Int32Array
  exitedCount: number
  changed: boolean
  /** The claimed difference's scratch (`./claimedDifference.ts`), held by its delta so that no
   *  record outlives it: one bit per held rank a claim names, and the records `pages` held before
   *  it is rewritten. */
  named: Uint32Array
  readonly before: PageRec[]
}

/** The held rank of each raw rank of a list of `count` that skipped ids, written from rank `from`
 *  on by the difference that found the first skip: ranks before it held their own. */
export function mapRawRanks(held: HeldList, count: number, from: number) {
  if (held.rawRank.length < count) held.rawRank = grown(held.rawRank, count)
  for (let i = 0; i < from; i++) held.rawRank[i] = i
  held.rawToHeld = true
  return held.rawRank
}
