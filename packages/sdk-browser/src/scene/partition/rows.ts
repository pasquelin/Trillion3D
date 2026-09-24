/**
 * The rows a partitioned scene places its cells' nodes on. Each mesh the cells place is drawn by
 * one host mesh per primitive whose association carries an instance buffer (`placement/rows.ts`):
 * a cell's node takes the same row in every one of them, and gives it back — parked — when its
 * cell leaves. A mesh short of rows grows every buffer to the same larger capacity
 * (`growPlacementRows`), which the session takes in place where its path can (`growth.ts`).
 */
import {
  createPlacementRows,
  growPlacementRows,
  type PlacementRows,
} from '../../placement/rows.ts';
import { MATRIX_VALUES } from '../../../../sdk-core/src/index.ts';
import type { CellNode } from '../../../../sdk-core/src/scene/core/tablePartition.ts';
import { GraphNode } from '../../host/graph/node.ts';
import { pose } from '../../host/prepared/nodes.ts';
import { hostLocalInto } from '../../host/world/matrices.ts';

const scratch = new GraphNode();

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

/** Hands the session each buffer a mesh replaced and its successor. */
export type GrowRows = (from: PlacementRows, to: PlacementRows) => void;

/** A placed mesh over `links`, each given one parked row. */
export function placedMesh(links: readonly RowLink[]): PlacedMesh {
  for (const link of links) link.placements = createPlacementRows(1);
  return { links, free: [0] };
}

/** How many rows every link of `mesh` holds. */
const capacityOf = (mesh: PlacedMesh) => mesh.links[0]?.placements?.capacity ?? 0;

/** Grows every buffer of `mesh` to hold `needed` rows, handing each replacement to `grow`. */
function growMesh(mesh: PlacedMesh, needed: number, grow: GrowRows) {
  const held = capacityOf(mesh);
  if (needed <= held) return;
  let capacity = held;
  for (const link of mesh.links) {
    const from = link.placements!;
    const to = growPlacementRows(from, needed);
    link.placements = to;
    capacity = to.capacity;
    grow(from, to);
  }
  for (let row = capacity - 1; row >= held; row--) mesh.free.push(row);
}

/** Reserves `count` more rows of `mesh`, growing it when it is short. */
export function reserveRows(mesh: PlacedMesh, count: number, grow: GrowRows) {
  if (mesh.free.length < count) growMesh(mesh, capacityOf(mesh) + count - mesh.free.length, grow);
}

/** Takes a free row of `mesh` (`reserveRows` first). */
export const takeRow = (mesh: PlacedMesh) => mesh.free.pop()!;

/** Parks `row` of every buffer of `mesh` and frees it. */
export function releaseRow(mesh: PlacedMesh, row: number) {
  for (const link of mesh.links) link.placements!.live[row] = 0;
  mesh.free.push(row);
}
