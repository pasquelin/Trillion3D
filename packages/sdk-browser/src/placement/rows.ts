/**
 * PLACEMENT ROWS: the instance buffer of one drawn resource.
 *
 * A resource — a primitive cut into pages, worn with one surface — is drawn at many places. Its
 * placements are not host nodes: they are rows of one buffer the owner writes, sixteen
 * column-major floats each, and a flag saying whether the row places the resource or is parked.
 * The engine reads each row IN PLACE: a cluster root's world matrix is a view on its row
 * (`placementWorld`), so a pose the owner writes is the pose the next frame reads, with nothing
 * copied. A parked row keeps its root in every table and is skipped by every cut: taking it back
 * is writing its matrix and raising its flag, never rebuilding a table.
 *
 * The capacity is the owner's decision; a resource that needs more rows than it holds is given a
 * larger buffer, which the session grows into in place where its engine can
 * (`growth.ts`), and is opened again with otherwise.
 */
import type { MatrixElements } from '../math/matrixElements.ts';

export type PlacementRows = {
  /** Sixteen column-major floats per row, written by the owner. */
  readonly matrices: Float64Array;
  /** 1 where the row places the resource, 0 where it is parked. */
  readonly live: Uint8Array;
  readonly capacity: number;
};

export function createPlacementRows(capacity: number): PlacementRows {
  const rows = Math.max(1, capacity);
  return { matrices: new Float64Array(rows * 16), live: new Uint8Array(rows), capacity: rows };
}

/** The capacity a table holding `held` entries grows to when it needs `needed`: twice as large at
 *  least, so growing one entry at a time grows it a logarithmic number of times. */
export const grownCapacity = (held: number, needed: number) => Math.max(needed, held * 2);

/** A larger buffer for `needed` rows (`grownCapacity`): `before`'s rows copied first, the new
 *  ones parked. */
export function growPlacementRows(before: PlacementRows | null, needed: number) {
  const rows = createPlacementRows(grownCapacity(before?.capacity ?? 0, needed));
  if (before) {
    rows.matrices.set(before.matrices);
    rows.live.set(before.live);
  }
  return rows;
}

/** The world matrix of row `index`: a view on the buffer, never a copy. */
export const placementWorld = (rows: PlacementRows, index: number): MatrixElements => ({
  elements: rows.matrices.subarray(index * 16, index * 16 + 16),
});

/** What a root or a blended copy carries of the row it was collected from: the rows, and its rank
 *  in them. */
export type PlacementOf = { rows: PlacementRows; index: number };

/** True when `placement` names a row the owner parked: its draw is skipped, its place kept. */
export const rowParked = (placement: PlacementOf | undefined) =>
  !!placement && placement.rows.live[placement.index] === 0;

/** True when one of `placed` — blended copies, blend items — is posed by a row of `rows`. */
export const placedBy = (
  placed: readonly { readonly placement?: PlacementOf }[],
  rows: PlacementRows,
) => placed.some((entry) => entry.placement?.rows === rows);
