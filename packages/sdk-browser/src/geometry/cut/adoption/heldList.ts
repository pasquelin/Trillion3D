import type { PageRec } from '../../selection/types.ts'
import type { createSparseInts } from '../sparseInts.ts'

/**
 * A delta as its difference writes it: the held list and its records, the marks, and the buffers
 * the next list is written into. The difference writes the next ids into `next`, the entries and
 * exits and their counts, the raw sequence into `published`, and returns the next count; the delta
 * then makes `next` the held list.
 */
export type HeldList = {
  /** A packed rank back to its record: the one catalogue accessor. None for a list of ids alone:
   *  every id it names is listed. */
  readonly recordOf: ((id: number) => PageRec | undefined) | undefined
  /** Epoch of the list where the id was last held: an id the held list holds carries `epoch`, an
   *  id it does not hold carries nothing. */
  readonly mark: ReturnType<typeof createSparseInts>
  /** The records, rank by rank beside the held ids, when the caller keeps them. */
  readonly pages: PageRec[] | undefined
  epoch: number
  ids: Int32Array
  count: number
  next: Int32Array
  /** The id sequence the last list published, raw — repeats and ids without a record included. */
  published: Int32Array
  publishedCount: number
  entered: Int32Array
  enteredCount: number
  exited: Int32Array
  exitedCount: number
  changed: boolean
}

/** Marks `id` with `value` when the list holds it — it has a record, or the list names no
 *  records — and returns the mark it had; an id without a record answers `value`, as a repeat
 *  does: the difference skips it. */
export const markListed = (held: HeldList, id: number, rec: PageRec | undefined, value: number) =>
  rec || !held.recordOf ? held.mark.set(id, value) : value
