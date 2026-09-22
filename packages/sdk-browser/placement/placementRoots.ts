import type { MatrixElements } from '../matrixElements.ts';
import { placementWorld, type PlacementOf, type PlacementRows } from './placementRows.ts';

/** One place a collected mesh is drawn at: its world, whether it is parked, and its row. */
export type Placed = { world: MatrixElements; parked: boolean; placement?: PlacementOf };

/**
 * Where a collected mesh is drawn: at its own node's world, or — when its association carries an
 * instance buffer — at every row of it, parked rows included, each world a view on its row. The
 * association is the host's link from a node to its primitive; the rows ride on it because they
 * name the same thing, the primitive, placed elsewhere.
 */
export function placementsOf(
  association: { placements?: PlacementRows } | undefined,
  ownWorld: () => MatrixElements,
): Placed[] {
  const rows = association?.placements;
  if (!rows) return [{ world: ownWorld(), parked: false }];
  const placed: Placed[] = new Array(rows.capacity);
  for (let index = 0; index < rows.capacity; index++)
    placed[index] = {
      world: placementWorld(rows, index),
      parked: rows.live[index] === 0,
      placement: { rows, index },
    };
  return placed;
}

/** The one world of a mesh drawn whole — a transparent or transmissive surface is drawn per
 *  source mesh, in its order — refused by name when an instance buffer was handed for it. */
export function onePlacement(placed: readonly Placed[], mesh: { name: string }) {
  if (placed.length !== 1 || placed[0].placement)
    throw new Error(`PLACEMENT_ROWS_OPAQUE_ONLY: ${mesh.name}`);
  return placed[0].world;
}
