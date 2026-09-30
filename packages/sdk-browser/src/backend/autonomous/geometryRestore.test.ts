// #846: a class change restores some of the records a rowed page shares: the geometry the others
// still draw is not given back. #1234: the draw state lives in a `PageDraws` table.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { createAutonomousGeometry } from './geometry.ts';
import type { PageRec } from '../../page/selection/types.ts';
import { makeRec, recDraws, recRoots, trianglePage } from './pageRec.fixture.ts';
import type { PageDraws } from './pageDraws.ts';

/** A resident record of page `u`, its root placed by a row. */
const rowed = (id: number): PageRec => ({ ...makeRec(id, 1), url: 'u' });

test('records restored alone leave the rowed geometry the others draw', () => {
  const shared = new G.Geometry();
  let disposed = 0;
  shared.dispose = () => void disposed++;
  const [moved, kept] = [rowed(0), rowed(1)];
  const scene = { add() {}, remove() {} } as unknown as Parameters<
    typeof createAutonomousGeometry
  >[0]['scene'];
  const roots = recRoots({} as never, [moved, kept]);
  const draws = recDraws([moved, kept], {} as never);
  draws.drawing(moved).geometry = shared;
  draws.drawing(kept).geometry = shared;
  draws.drawing(moved).material = new G.GraphSurface('basic');
  draws.drawing(kept).material = new G.GraphSurface('basic');
  const store = createAutonomousGeometry({
    scene,
    roots,
    allPages: [moved, kept],
    bootstrap: [],
    views: { live: { shown: [], shownPacked: [] }, lists: () => [] },
    byUrl: new Map([['u', [moved, kept]]]),
    descriptors: new Map(),
    draws,
    colorMaterials: new Map(),
    modifiedPages: new Set(),
  });
  store.restoreRecords([moved], trianglePage());
  assert.equal(disposed, 0, 'the record left on the page still draws it');
  assert.equal(draws.geometryOf(kept), shared);
  assert.notEqual(draws.geometryOf(moved), shared);
  store.removeRecords([kept]);
  assert.equal(disposed, 1, 'the last remaining owner releases the old shared geometry');
});

test('initial rowed page storage reads geometry linearly, without searching other empty records', () => {
  for (const count of [64, 256]) {
    const records = Array.from({ length: count }, (_, id) => ({ ...rowed(id), array: undefined }));
    const scene = { add() {}, remove() {} } as unknown as Parameters<
      typeof createAutonomousGeometry
    >[0]['scene'];
    const material = new G.GraphSurface('basic');
    const table = recDraws(records, {} as never);
    for (const rec of records) table.drawing(rec).material = material;
    let finds = 0;
    const draws = {
      ...table,
      find: (rec: PageRec) => (finds++, table.find(rec)),
    } as PageDraws;
    const store = createAutonomousGeometry({
      scene,
      roots: recRoots({} as never, records),
      allPages: records,
      bootstrap: [],
      views: { live: { shown: [], shownPacked: [] }, lists: () => [] },
      byUrl: new Map([['u', records]]),
      descriptors: new Map(),
      draws,
      colorMaterials: new Map(),
      modifiedPages: new Set(),
    });
    store.restoreRecords(records, trianglePage());
    assert.ok(finds <= count * 3, `${count} initial records took ${finds} geometry reads`);
    const first = draws.geometryOf(records[0]);
    assert.ok(first);
    assert.ok(
      records.every((rec) => draws.geometryOf(rec) === first),
      'one geometry shared by every row',
    );
    assert.equal(store.state.allocationBytes, 48, 'the shared geometry is counted once');
    store.dispose();
  }
});
