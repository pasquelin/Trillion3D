/**
 * WHERE EACH MAP'S PAGE TABLE LIES (`frameSetup.ts`), a frame's: a map holds the pages of its mips
 * from its finest one on, so its table is sized by that mip alone — a block of `S` = 128 >> finest
 * entries a side and its mip tail below (`S × 3S/2`, one entry for a one-page map) —, and the
 * frame's maps are packed into the page table's blocks of 128 × 192 by quarters: a block of side S
 * is four of side S/2. The suns' levels come first (their receiver cover holds the first blocks);
 * every map's origin is written into its record (`tableOrigin`, x | y << 16), which every reader of
 * the tables adds (`vsmTableLevelOrigin`). A light far from the eye thus takes one entry, a near one
 * a whole block: the tables follow the view, whatever the count of lights.
 */
import { VSM_LEVEL0_PAGES, VSM_MIPS, VSM_PAGE_TABLE_BLOCK_HEIGHT } from './constants.ts'
import { VSM_TABLES_PER_ROW } from './layout.ts'

/** The rows a table of side `side` spans: its level and its mip tail below, one for a one-entry
 *  table. */
const tableRows = (side: number) => (side === 1 ? 1 : (3 * side) / 2)

/** The frame's table packing: free quarters by finest mip, and the next whole block. */
export class VsmTableBlocks {
  /** Origins (x | y << 16) of the free quarters of side 128 >> k, by k. */
  private readonly free: number[][] = Array.from({ length: VSM_MIPS }, () => [])
  /** Whole blocks taken. */
  blocks = 0

  /** Empties the packing for a new frame, keeping its storage. */
  reset() {
    for (const list of this.free) list.length = 0
    this.blocks = 0
    return this
  }

  /** The origin of a table whose finest mip is `finest`: a free quarter of its side, else one cut
   *  from a table of twice its side, else a new block. */
  take(finest: number): number {
    const free = this.free[finest]
    if (free.length) return free.shift()!
    if (finest === 0) {
      const b = this.blocks++
      const x = (b % VSM_TABLES_PER_ROW) * VSM_LEVEL0_PAGES,
        y = Math.floor(b / VSM_TABLES_PER_ROW) * VSM_PAGE_TABLE_BLOCK_HEIGHT
      return x | (y << 16)
    }
    const parent = this.take(finest - 1)
    const side = VSM_LEVEL0_PAGES >> finest,
      rows = tableRows(side)
    for (let c = 1; c < 4; c++) free.push(parent + (c & 1) * side + (((c >> 1) * rows) << 16))
    return parent
  }
}
