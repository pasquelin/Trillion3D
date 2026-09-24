// A7: residency url sets (pendingUrls, pageUrls, collectPendingUrls) live as long as the
// host instead of being rebuilt every frame. Oracle: the versions from before batch A, in
// `../../../../../bench/oracles/browser/selection.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { collectPendingUrls } from '../../page/selection/requests.ts';
import { createAutonomousResidency } from './residency.ts';
import {
  referenceCollectPendingUrls,
  referenceResidency,
} from '../../../../../bench/oracles/browser/selection.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import { surfaceOf } from '../../page/surface.ts';

// A minimal but complete geometry store: only `releasePage` is read by
// `createAutonomousResidency`, but its parameter type is the full geometry-store shape.
function fakeGeometryStore() {
  return {
    state: { allocationBytes: 0, submittedTriangles: 0, residentPages: 0 },
    colorMaterials: new Map(),
    releasePage: (_url: string) => false,
    sync: () => {},
    rowsWritten: () => {},
    dispose: () => {},
    removeRecords: () => {},
    storeGeometryPage: () => false,
    acceptGeometryPage: () => false,
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
    material: surfaceOf([]),
    declaration: [],
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

test('dropPage counts one eviction per page the store held, never the root cover', () => {
  const geometryStore = fakeGeometryStore();
  let held = true;
  geometryStore.releasePage = () => {
    const was = held;
    held = false;
    return was;
  };
  const residency = createAutonomousResidency({ ...makeEnv(), geometryStore });
  residency.dropPage('a.bin');
  assert.equal(held, true, 'the root cover is never given back');
  residency.dropPage('g.bin');
  residency.dropPage('g.bin');
  assert.equal(residency.cacheEvictions, 1, 'a page that held nothing is not evicted again');
});

test('the streamer pins the set the image gathered, without gathering it again', () => {
  const env = makeEnv();
  const residency = createAutonomousResidency({
    ...env,
    geometryStore: fakeGeometryStore(),
  });
  const pinned = [...residency.pageUrls()];
  env.shown.push(fakePageRec('z.bin'));
  assert.deepEqual(residency.pageUrls(), pinned, 'read, not rebuilt');
  assert.ok(!residency.keptUrls().has('z.bin'));
  residency.keptChanged();
  assert.ok(residency.pageUrls().includes('z.bin'));
  assert.equal(residency.keptUrls().size, pinned.length + 1);
});
