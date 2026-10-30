import type { RootOffsetRow } from '../../geometry/rows/page/offsetRow.ts'
import { placementStoredChannelsOf } from '../../geometry/dag/info/placementInfoLayout.ts'

/**
 * WHAT THE ROOTS OF A SESSION HOLD OF THEIR OFFSETS (`offsetReach.ts` writes it, the page-row writer
 * reads it): by the root's rank, the row of words its object says of the offsets its surfaces move
 * vertices by (`RootOffsetRow`) and of the object itself (its bits) — none for a root that says nothing —, and the ranks of the
 * rows that ask `always`, in the order they were first held, which is all the image walks. Also held: how many
 * of the rows say their object is in a lighting channel other than the default's (`channelled`, which the
 * lit programs' channel cut reads).
 */
export function createRootOffsets() {
  const rows: (RootOffsetRow | undefined)[] = []
  const always: number[] = []
  let channelled = 0
  // The roots whose objects ask for the custom depth, and a count that moves whenever the set does.
  const asking = new Set<number>()
  let askRevision = 0
  /** Whether the object of `row` is in a lighting channel set other than the default's. */
  const isChannelled = (row: RootOffsetRow | undefined) =>
    placementStoredChannelsOf(row?.bits ?? 0) !== 0
  const asksCustomDepth = (row: RootOffsetRow | undefined) => (row?.customDepth ?? 0) !== 0
  const asksAlways = (row: RootOffsetRow | undefined) => row?.cache === 'always'
  /** Whether two rows say the same. */
  const same = (a: RootOffsetRow, b: RootOffsetRow) =>
    a.bits === b.bits &&
    a.customDepth === b.customDepth &&
    a.evaluate === b.evaluate &&
    a.velocity === b.velocity &&
    a.disable === b.disable &&
    a.most === b.most &&
    a.worn === b.worn &&
    a.always === b.always &&
    a.cache === b.cache &&
    a.centre.every((value, k) => value === b.centre[k])
  const offsets = {
    /** Root `rank`'s row, none for a root that says nothing. */
    rowOf: (rank: number) => rows[rank],
    /** The ranks of the roots whose objects keep their shadows `always`. */
    always: (): readonly number[] => always,
    /** How many roots' objects are in a lighting channel other than the default's. */
    channelled: () => channelled,
    /** The ranks of the roots whose objects ask for the custom depth, and a count that moves with the set. */
    askingCustomDepth: (): ReadonlySet<number> => asking,
    customDepthRevision: () => askRevision,
    /** Root `rank` takes `row` (none: it says nothing). True when it changed what a placement, a page or an item holds. */
    hold(rank: number, row: RootOffsetRow | undefined) {
      const previous = rows[rank]
      if (previous === row || (previous && row && same(previous, row))) return false
      rows[rank] = row
      channelled += +isChannelled(row) - +isChannelled(previous)
      if (asksCustomDepth(row) !== asksCustomDepth(previous)) {
        if (asksCustomDepth(row)) asking.add(rank)
        else asking.delete(rank)
        askRevision++
      }
      if (asksAlways(row) && !asksAlways(previous)) always.push(rank)
      else if (!asksAlways(row) && asksAlways(previous)) always.splice(always.indexOf(rank), 1)
      return true
    },
    /** The roots from rank `count` on forgotten: the session holds fewer roots than it did. */
    shrink(count: number) {
      for (let rank = count; rank < rows.length; rank++)
        if (rows[rank]) offsets.hold(rank, undefined)
      rows.length = Math.min(rows.length, count)
    },
    /** Every root forgotten: the session's roots were laid again. */
    clear() {
      rows.length = 0
      always.length = 0
      channelled = 0
      asking.clear()
      askRevision++
    },
  }
  return offsets
}

export type RootOffsets = ReturnType<typeof createRootOffsets>
