import type { PageSurface } from './surface.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { rowsMoved, rowsUnread, type RowsReading } from '../webgpu/row/dirty.ts';

/** The distinct surfaces of a row table's packed rows, and the rows and table age they were
 *  read at; held per table, so a runtime that never draws a row keeps nothing. */
type RowSurfaces = { read: RowsReading; epoch: number; surfaces: PageSurface[] };
const rowSurfaces = new WeakMap<object, RowSurfaces>();

/**
 * The surfaces rows `[0, count)` wear, each once: the rows are walked again only once written, or
 * once the table ages — a record takes another surface in place (`wearDeclaration`) under a new
 * age, before its rows are written again.
 */
export function surfacesOfRows(rows: WebgpuPagesRuntime['layout']['rows']) {
  let held = rowSurfaces.get(rows);
  if (!held) rowSurfaces.set(rows, (held = { read: rowsUnread(), epoch: -1, surfaces: [] }));
  const moved = rowsMoved(held.read, rows.packedRecs, rows.packedCount, rows.rowWrites);
  if (!moved && held.epoch === rows.tableEpoch) return held.surfaces;
  held.epoch = rows.tableEpoch;
  const seen = new Set<PageSurface>();
  let last: PageSurface | undefined;
  for (let i = 0; i < rows.packedCount; i++) {
    const surface = rows.packedRecs[i]?.material;
    // Rows of one surface run together: the run skips the set.
    if (!surface || surface === last) continue;
    last = surface;
    seen.add(surface);
  }
  held.surfaces = [...seen];
  return held.surfaces;
}
