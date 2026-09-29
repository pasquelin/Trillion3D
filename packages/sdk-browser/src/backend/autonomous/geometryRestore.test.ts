// #846: a class change restores some of the records a rowed page shares: the geometry the others
// still draw is not given back.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { createAutonomousGeometry } from './geometry.ts';
import type { PageRec } from '../../page/selection/types.ts';
import { makeRec, recRoots, trianglePage } from './pageRec.fixture.ts';

/** A resident record of page `u`, drawing `geometry`, its root placed by a row. */
const rowed = (id: number, geometry: G.Geometry): PageRec => ({
  ...makeRec(id, 1),
  url: 'u',
  geometry,
  mesh: undefined,
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
    ...{ scene, roots: recRoots({} as never), allPages: [moved, kept] },
    bootstrap: [],
    ...{ views: { live: { shown: [] }, lists: () => [] } },
    ...{ byUrl: new Map([['u', [moved, kept]]]), descriptors: new Map() },
    ...{ baseMaterials: new Map([[moved, new G.GraphSurface('basic') as never]]) },
    ...{ colorMaterials: new Map(), modifiedPages: new Set() },
  } as Parameters<typeof createAutonomousGeometry>[0]);
  store.restoreRecords([moved], trianglePage());
  assert.equal(disposed, 0, 'the record left on the page still draws it');
  assert.equal(kept.geometry, shared);
  assert.notEqual(moved.geometry, shared);
});
