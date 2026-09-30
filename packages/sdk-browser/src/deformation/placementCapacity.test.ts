import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { createWorldBatches } from '../world/core/worldBatches.ts';
import type { Cut } from '../world/core/worldCuts.ts';
import type { MaterialEntry } from '../world/core/worldMaterials.ts';
import { drawnInstancedAt } from '../placement/autonomousPlacements.ts';
import type { ClusterRoot, PageRec } from '../page/selection/selection.ts';

test('deformation row growth requests a structural reopen while stable owners retain their rows', () => {
  const batches = createWorldBatches(() => {});
  const cut = { key: 'morph', drawn: { deformation: { targets: [{}] } } } as unknown as Cut;
  const material = { id: 1 } as MaterialEntry;
  const first = new Mesh(),
    second = new Mesh();
  batches.seat(first, cut, material);
  const [batch] = batches.reopen();
  const rows = batch.rows;
  assert.equal(rows!.sources![batches.seats.get(first)!.row], first);
  batches.seat(second, cut, material);
  let grown = false;
  batches.growHeld(() => {}, {
    growsInPlace: () => true,
    growPlacements() {
      grown = true;
    },
  });
  assert.equal(grown, false);
  assert.equal(batch.rows, rows);
  assert.equal(batches.waiting(), true);
  batches.reopen();
  assert.notEqual(batch.rows, rows);
  assert.equal(batch.rows!.sources![batches.seats.get(second)!.row], second);
});

test('WebGL keeps deformation placements separate when their records differ', () => {
  const page = { placementIndex: 0, transparent: false, deformRecord: 1 } as PageRec;
  const roots = [{ placement: {} }] as ClusterRoot<PageRec>[];
  assert.equal(drawnInstancedAt(roots, 0, page), false);
  page.deformRecord = 0;
  assert.equal(drawnInstancedAt(roots, 0, page), true);
});
