import type { RootOffsetRow } from '../../geometry/rows/page/offsetRow.ts'

/**
 * WHAT THE ROOTS OF A SESSION HOLD OF THEIR OFFSETS (`offsetReach.ts` writes it, the page-row writer
 * reads it): by the root's rank, the row of words its object says of the offsets its surfaces move
 * vertices by (`RootOffsetRow`) — none for a root that wears no offset —, and the ranks of the roots
 * that wear one, in the order they were first held, which is all the image walks.
 */
export function createRootOffsets() {
  const rows: (RootOffsetRow | undefined)[] = []
  const ranks: number[] = []
  const same = (a: RootOffsetRow, b: RootOffsetRow) =>
    a.evaluate === b.evaluate &&
    a.velocity === b.velocity &&
    a.disable === b.disable &&
    a.most === b.most &&
    a.worn === b.worn &&
    a.always === b.always &&
    a.cache === b.cache &&
    a.firstPerson === b.firstPerson &&
    a.holdout === b.holdout &&
    a.centre.every((value, k) => value === b.centre[k])
  return {
    /** Root `rank`'s row, none for a root that wears no offset. */
    rowOf: (rank: number) => rows[rank],
    /** The ranks of the roots that wear an offset. */
    ranks: (): readonly number[] => ranks,
    /** Root `rank` takes `row` (none: it wears no offset): whether it changed. */
    hold(rank: number, row: RootOffsetRow | undefined) {
      const held = rows[rank]
      if (held === row || (held && row && same(held, row))) return false
      rows[rank] = row
      if (row && !held) ranks.push(rank)
      else if (!row) ranks.splice(ranks.indexOf(rank), 1)
      return true
    },
    /** Every root forgotten: the session's roots were laid again. */
    clear() {
      rows.length = 0
      ranks.length = 0
    },
  }
}

export type RootOffsets = ReturnType<typeof createRootOffsets>
