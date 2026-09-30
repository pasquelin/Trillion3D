import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { createPageStore } from './pageStore.ts';
import { makeRec, recDraws, recRoots, trianglePage } from './pageRec.fixture.ts';
import type { PageRec } from '../../page/selection/types.ts';
import type { PageDraws } from './pageDraws.ts';

test('storing one page indexes geometry ownership once regardless of placement count', () => {
  let reads = 0;
  const records = Array.from({ length: 128 }, (_, i) => ({ ...makeRec(i, 1), url: 'shared' }));
  const table = recDraws(records, {} as never);
  for (const rec of records) table.drawing(rec).material = new G.GraphSurface('basic');
  // Every geometry the ownership scan reads goes through the table: count those reads.
  const draws = {
    ...table,
    find: (rec: PageRec) => (reads++, table.find(rec)),
  } as PageDraws;
  const store = createPageStore({
    roots: recRoots({} as never, records),
    byUrl: new Map([['shared', records]]),
    descriptors: new Map(),
    colorMaterials: new Map(),
    modifiedPages: new Set(),
    draws,
    state: { allocationBytes: 0, residentPages: 0 },
    release() {},
    setArray(rec, array) {
      rec.array = array;
    },
  });
  store.restoreRecords(records, trianglePage());
  assert.ok(reads <= records.length * 2, `geometry reads: ${reads}`);
  assert.equal(new Set(records.map((rec) => draws.geometryOf(rec))).size, 1);
  draws.geometryOf(records[0])?.dispose();
});
