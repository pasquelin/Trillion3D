/**
 * Rows whose table words changed since the last upload, row by row. The span `[from, to]` bounds
 * them for the readers that take one interval; the marks name each row exactly, so a model whose
 * rows are scattered across the table sends those rows and no row of the terrain between them.
 */
export function createDirtyRows(drawSlots: number) {
  const marks = new Uint8Array(drawSlots);
  const span = { from: drawSlots, to: -1 };
  return {
    marks,
    span,
    /** Declares rows `[from, to]` dirty. */
    mark(from: number, to = from) {
      if (to === from) marks[from] = 1;
      else marks.fill(1, from, to + 1);
      if (from < span.from) span.from = from;
      if (to > span.to) span.to = to;
    },
    /** Every row uploaded: the marks cleared on the span alone. */
    clear() {
      if (span.to >= span.from) marks.fill(0, span.from, span.to + 1);
      span.from = drawSlots;
      span.to = -1;
    },
  };
}

/** A reader of row runs; `ctx` spares it a closure allocated per image. */
export type RowRunVisitor<C> = (ctx: C, from: number, to: number) => void;

/** Calls `visit` once per maximal run of marked rows within `[from, to]`, in increasing order. */
export function forEachDirtyRun<C>(
  marks: Uint8Array,
  from: number,
  to: number,
  ctx: C,
  visit: RowRunVisitor<C>,
) {
  let row = Math.max(0, from);
  while (row <= to) {
    const start = marks.indexOf(1, row);
    if (start < 0 || start > to) return;
    const after = marks.indexOf(0, start);
    const end = after < 0 || after > to ? to : after - 1;
    visit(ctx, start, end);
    row = end + 1;
  }
}

/**
 * Rows a witness of the table must rewrite, run by run: every dirty run within the drawable rank,
 * then the rows the rank just grew by beyond the `held` the witness holds. A stale witness has no
 * dirty run to trust and is left to its caller, which rewrites the whole rank.
 */
export function forEachRewrittenRun<C>(
  rows: { dirtyMarks: Uint8Array; dirtyFrom: number; dirtyTo: number; packedCount: number },
  held: number,
  ctx: C,
  visit: RowRunVisitor<C>,
) {
  const last = rows.packedCount - 1,
    grown = rows.packedCount > held;
  const to = Math.min(rows.dirtyTo, grown ? held - 1 : last);
  forEachDirtyRun(rows.dirtyMarks, rows.dirtyFrom, to, ctx, visit);
  if (grown) visit(ctx, held, last);
}
