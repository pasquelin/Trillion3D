// A7: residency url sets (pendingUrls, pageUrls, collectPendingUrls) live as long as the
// host instead of being rebuilt every frame; A8: comptePagesResidentes counts instead of
// allocating an intermediate array. Oracle: the versions from before batch A, in
// `bench/oracles/selection.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { collectPendingUrls } from './pageSelectionRequests.ts';
import { comptePagesResidentes, createAutonomousResidency } from './autonomousResidency.ts';
import { referenceCollectPendingUrls, referenceResidency } from './bench/oracles/selection.ts';
import type { PageRec } from './pageSelection.ts';

// A minimal but complete geometry store: only `detach` and `state.allocationBytes` are read by
// `createAutonomousResidency`, but its parameter type is the full geometry-store shape.
function fakeGeometryStore() {
  return {
    state: { allocationBytes: 0, submittedTriangles: 0 },
    colorMaterials: new Map(),
    detach: () => {},
    sync: () => {},
    geometryBytes: () => 0,
    removeRecords: () => {},
    storeGeometryPage: () => {},
    acceptGeometryPage: () => {},
  };
}

function fakePageRec(url = '', array?: Uint32Array): PageRec {
  return {
    id: 0,
    url,
    clusterId: '',
    array,
    triangles: 0,
    indexBytes: 0,
    min: [0, 0, 0],
    max: [0, 0, 0],
    depthLayer: 0,
    attributes: {},
    material: [],
    matrix: new THREE.Matrix4(),
    renderOrder: 0,
    attached: false,
  };
}

function makeEnv() {
  const bootstrapUrls = new Set(['a.bin', 'b.bin']),
    modifiedPages = new Set(['c.bin']);
  const shown = [fakePageRec('a.bin'), fakePageRec('d.bin')],
    desired = [
      fakePageRec('a.bin', new Uint32Array(3)),
      fakePageRec('e.bin'),
      fakePageRec('e.bin'), // duplicate url in the desired list, on purpose
      fakePageRec('f.bin'),
    ];
  return { bootstrapUrls, modifiedPages, shown, desired };
}

test('pendingUrls and pageUrls match the reference on a normal host, called twice in a row', () => {
  const env = makeEnv();
  const optimisee = createAutonomousResidency({
    ...env,
    pending: [],
    retained: [],
    byUrl: new Map(),
    geometryStore: fakeGeometryStore(),
  });
  const reference = referenceResidency({ ...env, pending: [], retained: [] });
  for (const pass of [0, 1]) {
    assert.deepEqual(optimisee.pendingUrls(), reference.pendingUrls(), `pending pass ${pass}`);
    assert.deepEqual(optimisee.pageUrls(), reference.pageUrls(), `retained pass ${pass}`);
  }
});

test('an empty host produces empty sets from both implementations', () => {
  const empty = {
    bootstrapUrls: new Set<string>(),
    modifiedPages: new Set<string>(),
    shown: [],
    desired: [],
  };
  const optimisee = createAutonomousResidency({
    ...empty,
    pending: [],
    retained: [],
    byUrl: new Map(),
    geometryStore: fakeGeometryStore(),
  });
  const reference = referenceResidency({ ...empty, pending: [], retained: [] });
  assert.deepEqual(optimisee.pendingUrls(), []);
  assert.deepEqual(reference.pendingUrls(), []);
  assert.deepEqual(optimisee.pageUrls(), []);
  assert.deepEqual(reference.pageUrls(), []);
});

test('collectPendingUrls dedups by streamUrl and skips resident pages, matching the reference', () => {
  const shown = [
    { url: 'p0.bin', array: new Uint32Array(1) }, // resident: skipped
    { url: 'p1.bin', streamUrl: 'bundle.bin' },
    { url: 'p2.bin', streamUrl: 'bundle.bin' }, // same bundle: deduped
    { url: 'p3.bin' },
  ];
  const optimisee = collectPendingUrls(shown, []);
  const reference = referenceCollectPendingUrls(shown, []);
  assert.deepEqual(optimisee, reference);
  assert.deepEqual(optimisee, ['bundle.bin', 'p3.bin']);
});

test('collectPendingUrls on an empty list returns an empty array from both sides', () => {
  assert.deepEqual(collectPendingUrls([], []), []);
  assert.deepEqual(referenceCollectPendingUrls([], []), []);
});

test('comptePagesResidentes counts resident pages without building an intermediate array', () => {
  const pages = [
    fakePageRec('', new Uint32Array(1)),
    fakePageRec(),
    fakePageRec('', new Uint32Array(0)),
    fakePageRec(),
  ];
  assert.equal(comptePagesResidentes(pages), 2);
  assert.equal(comptePagesResidentes(pages), pages.filter((p) => !!p.array).length);
  assert.equal(comptePagesResidentes([]), 0);
});
