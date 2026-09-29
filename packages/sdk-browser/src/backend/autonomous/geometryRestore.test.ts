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
  store.removeRecords([kept]);
  assert.equal(disposed, 1, 'the last remaining owner releases the old shared geometry');
});

test('initial rowed page storage reads geometry linearly, without searching other empty records', () => {
  for (const count of [64, 256]) {
    let reads = 0;
    const records = Array.from({ length: count }, (_, id) => {
      const rec = { ...makeRec(id, 1), url: 'u', array: undefined, mesh: undefined };
      let geometry: PageRec['geometry'];
      Object.defineProperty(rec, 'geometry', {
        get() {
          reads++;
          return geometry;
        },
        set(value: PageRec['geometry']) {
          geometry = value;
        },
        enumerable: true,
      });
      return rec;
    });
    const scene = { add() {}, remove() {} } as unknown as Parameters<
      typeof createAutonomousGeometry
    >[0]['scene'];
    const material = new G.GraphSurface('basic');
    const store = createAutonomousGeometry({
      scene,
      roots: recRoots({} as never),
      allPages: records,
      bootstrap: [],
      views: { live: { shown: [] }, lists: () => [] },
      byUrl: new Map([['u', records]]),
      descriptors: new Map(),
      baseMaterials: new Map(records.map((rec) => [rec, material])),
      colorMaterials: new Map(),
      modifiedPages: new Set(),
    });
    store.restoreRecords(records, trianglePage());
    assert.ok(reads <= count * 3, `${count} initial records took ${reads} geometry reads`);
    const first = records[0].geometry;
    assert.ok(first);
    assert.ok(
      records.every((rec) => rec.geometry === first),
      'one geometry shared by every row',
    );
    assert.equal(store.state.allocationBytes, 48, 'the shared geometry is counted once');
    store.dispose();
  }
});
