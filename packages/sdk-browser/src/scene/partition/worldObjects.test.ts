// #1333: a cell placing its nodes writes on each row the world-roots object it places, as the cook
// lists a cell's objects — per node, one per primitive of its mesh with a root cover, ascending —,
// found on the table's records (`cells.objects`, `cells.cellOf`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX_VALUES } from '../../../../sdk-core/src/index.ts';
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { createPlacementRows } from '../../placement/rows.ts';
import { createCellPlacements } from './placements.ts';
import type { PlacedMesh } from './rows.ts';

/** A mesh drawn by one host mesh per primitive of `primitives`, in that order, four rows each. */
const mesh = (primitives: number[]): PlacedMesh => ({
  links: primitives.map((p) => ({ primitives: p, placements: createPlacementRows(4) })),
  nodes: [],
  free: [3, 2, 1, 0],
  casts: [],
});

test('a placed cell names on each row the world-roots object it places (#1333)', () => {
  // Mesh 0 has primitives 1 and 0 (both with a root cover), mesh 1 primitive 2 (none: no object).
  const meshes = new Map([
    [0, mesh([1, 0])],
    [1, mesh([2])],
  ]);
  // Cell 0 holds objects 0 to 2; cell 1 nodes 20, 21 and 22: two objects each for 20 and 22.
  const objects = [
    { node: 20, primitive: 0 },
    { node: 20, primitive: 1 },
    { node: 22, primitive: 0 },
    { node: 22, primitive: 1 },
  ].map((object) => ({ ...object, roots: [], dependencies: [] }));
  const cells = {
    objects: (cell: number) => (cell === 1 ? objects : []),
    cellOf: (object: number) => (object >= 3 ? 1 : 0),
  };
  const rows = createCellPlacements(new Object3D(), [], meshes, cells);
  const nodes = 3,
    ranks = Int32Array.of(-1, 0, -1, 1, -1, 0);
  assert.ok(rows.place(1, { nodes, ranks, locals: new Float64Array(nodes * MATRIX_VALUES) }, 'c'));
  const [first, , last] = rows.held.get(1)!;
  const [byOne, byZero] = meshes.get(0)!.links.map((link) => link.placements!.origins!);
  // Node 20 places objects 3 (primitive 0) and 4 (primitive 1), node 22 objects 5 and 6.
  assert.deepEqual([byZero[first.row], byOne[first.row]], [3, 4]);
  assert.deepEqual([byZero[last.row], byOne[last.row]], [5, 6]);
  // Node 21's mesh has no root cover: its row places none.
  const second = rows.held.get(1)![1];
  assert.equal(meshes.get(1)!.links[0].placements!.origins![second.row], -1);
});
