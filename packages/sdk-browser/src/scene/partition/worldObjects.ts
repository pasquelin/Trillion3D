/**
 * THE WORLD-ROOTS OBJECT EACH ROW OF A PLACED CELL DRAWS (#1333).
 *
 * The world DAG names an object root by its `origin`, the rank among the world-roots table's objects
 * of the placed object drawing it (docs/FORMAT.md, World super-roots). A cell's objects follow its
 * file's nodes in order, per node one for each primitive of its mesh with a root cover, ascending
 * (`compiler_world_roots/pack.rs`): a cell placing its nodes writes on each row the object it
 * places (`PlacementRows.origins`), which the cut that packs the world DAG reads when the row is
 * taken or parked, as a World Partition HLOD knows the actors of its cell. Read on the table's
 * records (#1232), never a second list of the world.
 */
import type { WorldRoots } from '../../../../sdk-core/src/manifest/worldRoots.ts';
import type { Placement } from './follow.ts';

/** The table's cells, as the partition reads them. */
export type WorldCells = Pick<WorldRoots['cells'], 'objects' | 'cellOf'>;

/** The rank of `cell`'s first object: the least object `cellOf` — the last cell starting at or
 *  before an object — puts in `cell` or past it. */
function firstObject(cells: WorldCells, cell: number) {
  let low = 0,
    high = 1;
  while (cells.cellOf(high) < cell) [low, high] = [high + 1, high * 2];
  while (low < high) {
    const mid = (low + high) >> 1;
    if (cells.cellOf(mid) < cell) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Writes on the rows `cell`'s `placements` took the object each places, -1 where none. */
export function writeCellOrigins(
  cells: WorldCells | undefined,
  cell: number,
  placements: readonly Placement[],
) {
  if (!cells) return;
  const objects = cells.objects(cell),
    base = objects.length ? firstObject(cells, cell) : 0;
  let at = 0;
  for (const { mesh, row } of placements) {
    // This node's objects: those that follow, of one node, each a primitive of its mesh.
    const node = objects[at]?.node;
    const own = (k: number) =>
      k < objects.length &&
      objects[k].node === node &&
      mesh.links.some((link) => link.primitives === objects[k].primitive);
    let end = at;
    while (own(end)) end++;
    for (const link of mesh.links) {
      const rows = link.placements!;
      const origins = (rows.origins ??= new Int32Array(rows.capacity).fill(-1));
      let object = -1;
      for (let k = at; k < end; k++)
        if (objects[k].primitive === link.primitives) object = base + k;
      origins[row] = object;
    }
    at = end;
  }
}
