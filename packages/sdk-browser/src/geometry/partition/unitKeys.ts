/**
 * THE KEYS OF THE UNITS THAT TAKE TURNS TO LOAD, three kinds on one line of numbers
 * (`loadSlots.ts`), each kind in a range of its own: a cell of the HLOD chain — an HLOD 0 cell the
 * plan meets (`plan.ts`) or one above it (`../hlod/hlodCells.ts`) — by its index in the chain, from
 * 0; the actors always loaded of a level (`../hlod/hlodTops.ts`) past the chain's cells, by the
 * chain's cell count and the level; a cell file of no layer below 0 (`plan.ts`), by its index in
 * the cell index. The load order knows none of this: it takes the keys as they are.
 *
 * Cost: O(1) a key.
 */

/** The key of the cell `cell` of the HLOD chain: its index. */
export const cellUnit = (cell: number) => cell

/** The key of the unit of the actors always loaded of `level` in a chain of `count` cells. */
export const topUnit = (count: number, level: number) => count + level

/** The key of the cell file of no layer `cell` of the cell index. */
export const fileUnit = (cell: number) => -1 - cell

/** Whether `key` is a cell file's. */
export const isFileUnit = (key: number) => key < 0

/** The cell file a key made by `fileUnit` names. */
export const fileOfUnit = (key: number) => -1 - key
