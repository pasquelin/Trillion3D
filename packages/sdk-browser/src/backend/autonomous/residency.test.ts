// A7: residency requests and retained ranks live as long as the host. Oracle: the URL versions in
// `../../../../../bench/oracles/browser/selection.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPendingUrls } from '../../page/selection/requests.ts';
import { createAutonomousResidency } from './residency.ts';
import {
  referenceCollectPendingUrls,
  referenceResidency,
} from '../../../../../bench/oracles/browser/selection.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import { surfaceOf } from '../../page/surface.ts';
import { createHeldResidency } from '../../page/cut/held.ts';
import { createPageDraws } from './pageDraws.ts';
import type { HostRetentionDelta } from '../../streaming/types.ts';

const urlsOf = (delta: HostRetentionDelta) =>
  Array.from(delta.held.subarray(0, delta.heldCount), (rank) => delta.urls[rank]);

// A minimal but complete geometry store: only `releasePage` is read by
// `createAutonomousResidency`, but its parameter type is the full geometry-store shape.
function fakeGeometryStore() {
  return {
    state: { allocationBytes: 0, submittedTriangles: 0, residentPages: 0 },
    held: createHeldResidency(),
    draws: createPageDraws(),
    colorMaterials: new Map(),
    releasePage: (_url: string) => false,
    sync: () => {},
    rowsWritten: () => {},
    dispose: () => {},
    removeRecords: () => {},
    storeGeometryPage: () => false,
    restoreRecords: () => {},
    storeReplaced() {},
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
    renderOrder: 0,
  };
}

function makeEnv() {
  const bootstrapUrls = new Set(['a.bin', 'b.bin']),
    modifiedPages = new Set(['c.bin']);
  // What the image asks for: one record per page (`requests.ts`).
  const shown = [fakePageRec('a.bin'), fakePageRec('d.bin')],
    requested = [
      fakePageRec('a.bin', new Uint32Array(3)),
      fakePageRec('e.bin'),
      fakePageRec('f.bin'),
    ];
  return { bootstrapUrls, modifiedPages, shown, requested };
}

test('pending URLs and retained ranks match the former URL set on repeated reads', () => {
  const env = makeEnv();
  const optimized = createAutonomousResidency({
    ...env,
    views: [env],
    geometryStore: fakeGeometryStore(),
  });
  const reference = referenceResidency({
    ...env,
    desired: env.requested,
    pending: [],
    retained: [],
  });
  for (const pass of [0, 1]) {
    assert.deepEqual(optimized.pendingUrls(), reference.pendingUrls(), `pending pass ${pass}`);
    assert.deepEqual(
      urlsOf(optimized.retainedRanks()),
      reference.pageUrls(),
      `retained pass ${pass}`,
    );
  }
});

test('an empty host produces empty sets from both implementations', () => {
  const empty = {
    bootstrapUrls: new Set<string>(),
    modifiedPages: new Set<string>(),
    shown: [],
    requested: [],
  };
  const optimized = createAutonomousResidency({
    ...empty,
    views: [empty],
    geometryStore: fakeGeometryStore(),
  });
  const reference = referenceResidency({ ...empty, desired: [], pending: [], retained: [] });
  assert.deepEqual(optimized.pendingUrls(), []);
  assert.deepEqual(reference.pendingUrls(), []);
  assert.deepEqual(urlsOf(optimized.retainedRanks()), []);
  assert.deepEqual(reference.pageUrls(), []);
});

test('collectPendingUrls dedups by streamUrl and skips resident pages, matching the reference', () => {
  const shown = [
    { url: 'p0.bin', array: new Uint32Array(1) }, // resident: skipped
    { url: 'p1.bin', streamUrl: 'bundle.bin' },
    { url: 'p2.bin', streamUrl: 'bundle.bin' }, // same bundle: deduped
    { url: 'p3.bin' },
  ];
  const optimized = collectPendingUrls(shown, []);
  const reference = referenceCollectPendingUrls(shown, []);
  assert.deepEqual(optimized, reference);
  assert.deepEqual(optimized, ['bundle.bin', 'p3.bin']);
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
  const env = makeEnv();
  const residency = createAutonomousResidency({ ...env, views: [env], geometryStore });
  residency.dropPage('a.bin');
  assert.equal(held, true, 'the root cover is never given back');
  residency.dropPage('g.bin');
  residency.dropPage('g.bin');
  assert.equal(residency.cacheEvictions, 1, 'a page that held nothing is not evicted again');
});

test('retained ranks hold the image until its cut changes', () => {
  const env = makeEnv();
  const residency = createAutonomousResidency({
    ...env,
    views: [env],
    geometryStore: fakeGeometryStore(),
  });
  const pinned = urlsOf(residency.retainedRanks());
  env.shown.push(fakePageRec('z.bin'));
  assert.deepEqual(urlsOf(residency.retainedRanks()), pinned, 'read, not rebuilt');
  assert.equal(residency.retainedRanks().enteredCount, 0);
  assert.ok(!urlsOf(residency.retainedRanks()).includes('z.bin'));
  residency.keptChanged();
  assert.ok(urlsOf(residency.retainedRanks()).includes('z.bin'));
  assert.equal(urlsOf(residency.retainedRanks()).length, pinned.length + 1);
});
