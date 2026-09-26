/**
 * The rows a partitioned scene places its cells' nodes on. Each mesh the cells place is drawn by
 * one host mesh per primitive whose association carries an instance buffer (`placement/rows.ts`):
 * a cell's node takes the same row in every one of them, and gives it back — parked — when its
 * cell leaves. The buffers are sized when a session opens, before its engines read them
 * (`sizeRows`), for every node its reach can hold at once (`plan.ts`): only a reach or a parent's
 * stretch past that grows them, in place, under the engine that draws them.
 */
import {
  createPlacementRows,
  growPlacementRows,
  type PlacementRows,
} from '../../placement/rows.ts';
import { EngineError, MATRIX_VALUES } from '../../../../sdk-core/src/index.ts';
import type { CellNode } from '../../../../sdk-core/src/scene/core/tablePartition.ts';
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { pose } from '../../host/prepared/nodes.ts';
import { hostLocalInto } from '../../host/world/matrices.ts';

const scratch = new Object3D();

/** The local matrix the engine composes for a cell node's declared pose, as for a host node. */
export function rowLocal(node: CellNode) {
  scratch.position.set(0, 0, 0);
  scratch.quaternion.set(0, 0, 0, 1);
  scratch.scale.set(1, 1, 1);
  pose(scratch, node);
  return hostLocalInto(new Float64Array(MATRIX_VALUES), scratch);
}

/** The association of a host mesh placed by rows: its mesh and primitive ranks, and the rows. */
export type RowLink = { meshes?: number; primitives?: number; placements?: PlacementRows };

/** One mesh the cells place: its primitives' links, sharing one row numbering. */
export type PlacedMesh = { readonly links: readonly RowLink[]; readonly free: number[] };

/** A placed mesh over `links`, each given one parked row. */
export function placedMesh(links: readonly RowLink[]): PlacedMesh {
  for (const link of links) link.placements = createPlacementRows(1);
  return { links, free: [0] };
}

/** How many rows every buffer of `mesh` holds. */
export const capacityOf = (mesh: PlacedMesh) => mesh.links[0]?.placements?.capacity ?? 0;

/** Sizes every buffer of each mesh rank of `needed` to hold that many rows at least, its rows
 *  kept: before its session's engines read them, or — `grown` handed each buffer replaced — under
 *  one that grows them in place (`placement/growth.ts`). */
export function sizeRows(
  meshes: ReadonlyMap<number, PlacedMesh>,
  needed: Map<number, number>,
  grown?: (from: PlacementRows, to: PlacementRows) => void,
) {
  for (const [rank, rows] of needed) {
    const mesh = meshes.get(rank);
    if (!mesh) continue; // placing its cell refuses it (`PREPARED_SCENE_MISMATCH`)
    const held = capacityOf(mesh);
    if (rows <= held) continue;
    for (const link of mesh.links) {
      const from = link.placements!;
      link.placements = growPlacementRows(from, rows);
      grown?.(from, link.placements);
    }
    for (let row = capacityOf(mesh) - 1; row >= held; row--) mesh.free.push(row);
  }
}

/** Whether each mesh `nodes` place has a free row for every one of them; a mesh the partition
 *  does not place is refused by name. */
export function rowsFree(
  meshes: ReadonlyMap<number, PlacedMesh>,
  nodes: readonly CellNode[],
  cell: string,
) {
  const needed = new Map<PlacedMesh, number>();
  for (const node of nodes) {
    const mesh = meshes.get(node.mesh);
    if (!mesh)
      throw new EngineError('PREPARED_SCENE_MISMATCH', `a scene cell places mesh ${node.mesh}`, {
        cell,
      });
    needed.set(mesh, (needed.get(mesh) ?? 0) + 1);
  }
  for (const [mesh, count] of needed) if (mesh.free.length < count) return false;
  return true;
}

/** Takes a free row of `mesh`. */
export const takeRow = (mesh: PlacedMesh) => mesh.free.pop()!;

/** Parks `row` of every buffer of `mesh` and frees it. */
export function releaseRow(mesh: PlacedMesh, row: number) {
  for (const link of mesh.links) link.placements!.live[row] = 0;
  mesh.free.push(row);
}

/** The range of rows each buffer had written since the last `flush`, which tells the engine. */
export function createTouchedRows() {
  const touched = new Map<RowLink, { from: number; to: number }>();
  return {
    touch(link: RowLink, row: number) {
      const range = touched.get(link) ?? { from: row, to: row };
      range.from = Math.min(range.from, row);
      range.to = Math.max(range.to, row);
      touched.set(link, range);
    },
    flush(update: (rows: PlacementRows, from: number, to: number) => void) {
      for (const [link, { from, to }] of touched) update(link.placements!, from, to);
      touched.clear();
    },
    clear: () => touched.clear(),
  };
}
