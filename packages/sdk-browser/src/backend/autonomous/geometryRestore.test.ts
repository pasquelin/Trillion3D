// #846: a class change restores some of the records a rowed page shares: the geometry the others
// still draw is not given back.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { createAutonomousGeometry } from './geometry.ts';
import type { PageRec } from '../../page/selection/types.ts';
import { makeRec } from './pageRec.fixture.ts';

/** A resident record of page `u`, placed by a row, drawing `geometry`. */
const rowed = (id: number, geometry: G.Geometry): PageRec => ({
  ...makeRec(id, 1),
  url: 'u',
  geometry,
  mesh: undefined,
  placement: {} as PageRec['placement'],
});

test('records restored alone leave the rowed geometry the others draw', () => {
  const shared = new G.Geometry();
  let disposed = 0;
  shared.dispose = () => void disposed++;
  const [moved, kept] = [rowed(0, shared), rowed(1, shared)];
  const scene = { add() {}, remove() {} } as unknown as Parameters<
    typeof createAutonomousGeometry
  >[0]['scene'];
  const store = createAutonomousGeometry({
    ...{ scene, allPages: [moved, kept], bootstrap: [] },
    ...{ views: { live: { shown: [] }, lists: () => [] } },
    ...{ byUrl: new Map([['u', [moved, kept]]]), descriptors: new Map() },
    ...{ baseMaterials: new Map([[moved, new G.GraphSurface('basic') as never]]) },
    ...{ colorMaterials: new Map(), modifiedPages: new Set() },
  } as Parameters<typeof createAutonomousGeometry>[0]);
  store.restoreRecords([moved], {
    indices: Uint32Array.of(0, 1, 2),
    attributes: { position: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0) },
    vertexCount: 3,
    flags: 0,
    decodedBytes: 48,
    quantizationError: 0,
  });
  assert.equal(disposed, 0, 'the record left on the page still draws it');
  assert.equal(kept.geometry, shared);
  assert.notEqual(moved.geometry, shared);
});
