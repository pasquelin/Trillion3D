import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { createPlacementRows } from '../placement/rows.ts';
import { createSessionDeformation } from './session.ts';
import type { ClusterRoot, PageRec } from '../page/selection/selection.ts';

test('a static batch reads its source capacities once and does not rescan them at draw', () => {
  const rows = createPlacementRows(128);
  let reads = 0;
  const owners = Array.from({ length: rows.capacity }, () => {
    const mesh = new Mesh();
    Object.defineProperty(mesh, 'waves', {
      get() {
        reads++;
        return null;
      },
    });
    return mesh;
  });
  rows.sources = owners;
  rows.sourceModels = new Set(owners);
  const roots = owners.map((mesh, index) => ({
    pages: [{ sourceMesh: mesh }],
    world: mesh.matrixWorld,
    placement: { rows, index },
  })) as unknown as ClusterRoot<PageRec>[];
  const session = createSessionDeformation(roots);
  assert.equal(reads, owners.length, 'one source read per owner, independent of row count');
  session.frame.bases.some = () => {
    throw new Error('draw rescanned static placement records');
  };
  for (let i = 0; i < owners.length; i++) assert.equal(session.any, false);
});
