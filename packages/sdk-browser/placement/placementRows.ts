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
 * The capacity is the owner's decision, made when the session is opened; a resource that needs
 * more rows than it holds is opened again with more.
 */
import type { MatrixElements } from '../matrixElements.ts';

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

/** The world matrix of row `index`: a view on the buffer, never a copy. */
export const placementWorld = (rows: PlacementRows, index: number): MatrixElements => ({
  elements: rows.matrices.subarray(index * 16, index * 16 + 16),
});

/** What a root carries of the row it was collected from: the rows, and its rank in them. */
export type PlacementOf = { rows: PlacementRows; index: number };
