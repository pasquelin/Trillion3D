import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { createPageStore } from './pageStore.ts';
import { makeRec, recRoots } from './pageRec.fixture.ts';

test('storing one page indexes geometry ownership once regardless of placement count', () => {
  let reads = 0;
  const records = Array.from({ length: 128 }, (_, i) => {
    const record = { ...makeRec(i, 1), url: 'shared' };
    let geometry: G.Geometry | undefined;
    Object.defineProperty(record, 'geometry', {
      get() {
        reads++;
        return geometry;
      },
      set(value: G.Geometry) {
        geometry = value;
      },
    });
    return record;
  });
  const store = createPageStore({
    roots: recRoots({} as never),
    byUrl: new Map([['shared', records]]),
    descriptors: new Map(),
    colorMaterials: new Map(),
    modifiedPages: new Set(),
    baseMaterials: new Map(records.map((rec) => [rec, new G.GraphSurface('basic')])),
    state: { allocationBytes: 0, residentPages: 0 },
    release() {},
    setArray(rec, array) {
      rec.array = array;
    },
  });
  store.restoreRecords(records, {
    indices: Uint32Array.of(0, 1, 2),
    attributes: { position: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0) },
    vertexCount: 3,
    flags: 0,
    decodedBytes: 48,
    quantizationError: 0,
  });
  assert.ok(reads <= records.length * 2, `geometry reads: ${reads}`);
  assert.equal(new Set(records.map((rec) => rec.geometry)).size, 1);
  records[0].geometry?.dispose();
});
