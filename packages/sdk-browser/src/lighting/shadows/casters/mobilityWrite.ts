import {
  MOBILITY_CORNER_SHIFT,
  MOBILITY_CUTOUT,
  MOBILITY_FAR_SHADOW,
  MOBILITY_MOVING,
  MOBILITY_SHADOWLESS,
} from '../mobilityBits.ts'
import { rankBits, rebuildRowIndex, type MobilityState } from './mobilityState.ts'

/** The row words of rows `[from, last]`, each from its row's placement, as one span pushed. */
function writeRowSpan(
  s: MobilityState,
  placementOf: (row: number) => number,
  from: number,
  last: number,
  alwaysMoving: number,
  corners: (row: number) => number,
  cutout: (row: number) => boolean,
  castFlags: (rank: number) => number,
) {
  for (let row = from; row <= last; row++) {
    const placement = placementOf(row),
      blended = row >= alwaysMoving,
      flags = rankBits(s, placement, castFlags) | (!blended && cutout(row) ? MOBILITY_CUTOUT : 0),
      word = (corners(row) << MOBILITY_CORNER_SHIFT) | flags
    if (s.rowRank[row] !== placement) {
      s.rowRank[row] = placement
      s.indexStale = true
    }
    s.rows[row] = word
  }
}

/** The rows of every placement `touch`ed since, written again where their bits changed, each run
 *  of rows in a row pushed as one span. */
function writeDirtyRows(
  s: MobilityState,
  push: (first: number, count: number) => void,
  castFlags: (rank: number) => number,
) {
  if (s.indexStale) rebuildRowIndex(s)
  const kept = ~(MOBILITY_MOVING | MOBILITY_SHADOWLESS | MOBILITY_FAR_SHADOW)
  for (const rank of s.dirtyList) {
    s.dirty[rank] = 0
    const bits = rankBits(s, rank, castFlags)
    let runFirst = -1,
      runLast = -2
    for (let k = s.indexStart[rank]; k < s.indexStart[rank + 1]; k++) {
      const row = s.indexRows[k],
        word = (s.rows[row] & kept) | bits
      if (word === s.rows[row]) continue
      s.rows[row] = word
      if (row !== runLast + 1) {
        if (runFirst >= 0) push(runFirst, runLast - runFirst + 1)
        runFirst = row
      }
      runLast = row
    }
    if (runFirst >= 0) push(runFirst, runLast - runFirst + 1)
  }
  s.dirtyList.length = 0
}

/**
 * Writes the row words of rows `[from, to]` — every row on a new table — from each row's
 * placement, then the rows of every placement `touch`ed since (moving or static, casting or
 * not), and hands each written span to push. A row from `alwaysMoving` on is a blended
 * caster's: moving as its placement is. A row `cutout` says is filed with the casters drawn
 * with the fragment test; a blended caster's never is: the transmittance pass reads the
 * other list alone. `corners` is the count a row draws, what its region's command is sized by.
 * `castFlags` says how a placement casts: `MOBILITY_SHADOWLESS` where it casts no shadow —
 * `castShadow = false`, hidden or parked —, which every caster pass skips, and `MOBILITY_FAR_SHADOW`
 * where it casts far shadows (`castFarShadow`), which a sun's far-shadow test never leaves out.
 */
export function writeMobilityRows(
  s: MobilityState,
  placementOf: (row: number) => number,
  rowCount: number,
  from: number,
  to: number,
  push: (first: number, count: number) => void,
  corners: (row: number) => number,
  alwaysMoving = rowCount,
  cutout: (row: number) => boolean = () => false,
  castFlags: (rank: number) => number = () => 0,
) {
  if (s.wholeRows) {
    from = 0
    to = rowCount - 1
    s.wholeRows = false
  }
  const last = Math.min(to, s.rows.length - 1)
  if (last >= from) {
    writeRowSpan(s, placementOf, from, last, alwaysMoving, corners, cutout, castFlags)
    push(from, last - from + 1)
  }
  if (s.dirtyList.length) writeDirtyRows(s, push, castFlags)
}
