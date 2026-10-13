import { createChangedRuns } from '../residency/ranges.ts'

/** A reader of row runs; `ctx` spares it a closure allocated per image. */
export type RowRunVisitor<C> = (ctx: C, from: number, to: number) => void
/** What walks the runs of dirty rows, the rows past `last` left out. */
type DirtyRuns = <C>(ctx: C, visit: RowRunVisitor<C>, last?: number) => void

/**
 * Rows whose table words changed since the last upload, row by row: the engine's one changed list
 * (`createChangedRuns`), neighbouring rows in one run, every run apart. A model whose rows are
 * scattered across the table sends those rows and no row of the terrain between them; a reader
 * walks the runs, never the table.
 */
export function createDirtyRows(drawSlots: number) {
  const changed = createChangedRuns(drawSlots, 1)
  let writes = 0
  const dirty = {
    /** Occupant writes since the table was made, never cleared: what `rowsMoved` compares. */
    get writes() {
      return writes
    },
    /** How many rows are dirty. */
    get count() {
      return changed.count
    },
    /**
     * Declares rows `[from, to]` dirty whose occupant, surface and class are kept — a pose, a
     * diagnostic word —: they are uploaded, and a `rowsMoved` reading still holds, so a model that
     * moves every image does not walk every row again.
     */
    markWords(from: number, to = from) {
      for (let row = from; row <= to; row++) changed.mark(row)
    },
    /** Declares rows `[from, to]` dirty: an occupant, a surface or a class may have changed. */
    mark(from: number, to = from) {
      writes++
      dirty.markWords(from, to)
    },
    /** Calls `visit` once per run of neighbouring dirty rows, in increasing order, the rows past
     *  `last` left out. */
    forEachRun: (<C>(ctx: C, visit: RowRunVisitor<C>, last = Infinity) => {
      const { count, pairs } = changed.runs()
      for (let run = 0; run < count && pairs[run * 2] <= last; run++)
        visit(ctx, pairs[run * 2], Math.min(pairs[run * 2 + 1], last))
    }) satisfies DirtyRuns,
    /** Every row uploaded: the marks cleared. */
    clear: changed.clear,
    /** The table grew to `rows` (`grow.ts`): the marks held so far are kept. */
    grow: changed.grow,
  }
  return dirty
}

/** What a reader derived from rows `[0, count)` of `table` was read at, `writes` marks in. */
export type RowsReading = { table: object | undefined; count: number; writes: number }
export const rowsUnread = (): RowsReading => ({ table: undefined, count: -1, writes: -1 })

/**
 * True when rows `[0, count)` of `table` may hold other words than when `reading` was taken, which
 * it then takes again. Every row write marks the row (`mark`), so a table, a count and a mark count
 * all unchanged are the same rows: a walk over hundreds of thousands of instance rows is done again
 * only when one of them moved, never once per image.
 */
export function rowsMoved(
  reading: RowsReading,
  table: object | undefined,
  count: number,
  writes: number,
) {
  if (reading.table === table && reading.count === count && reading.writes === writes) return false
  reading.table = table
  reading.count = count
  reading.writes = writes
  return true
}

/**
 * Rows a witness of the table must rewrite, run by run: every dirty run within the drawable rank,
 * then the rows the rank just grew by beyond the `held` the witness holds. A stale witness has no
 * dirty run to trust and is left to its caller, which rewrites the whole rank.
 */
export function forEachRewrittenRun<C>(
  rows: { forEachDirtyRun: DirtyRuns; packedCount: number },
  held: number,
  ctx: C,
  visit: RowRunVisitor<C>,
) {
  const last = rows.packedCount - 1,
    grown = rows.packedCount > held
  rows.forEachDirtyRun(ctx, visit, grown ? held - 1 : last)
  if (grown) visit(ctx, held, last)
}
