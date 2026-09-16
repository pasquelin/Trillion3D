import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptPageArray,
  collectClusterPages,
  collectPendingUrls,
  indexPagesByUrl,
  pageRequestUrl,
  selectVisiblePages,
} from './pageSelection.ts';
import { dagFixture, wideCamera } from './pageSelectionDagFixture.ts';
import { assertOneRepresentationPerGroup, withBundles } from './pageSelectionTestHelpers.ts';
import { cameraMoteur } from './cameraFixture.ts';

test('a streaming bundle is one request that makes every cluster it carries drawable', () => {
  const fixture = dagFixture();
  const bundled = withBundles(fixture);
  const { roots, allPages } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    new Map(),
    fixture.associations,
    { allowMissing: true },
  );
  const byUrl = indexPagesByUrl(allPages);
  assert.deepEqual(
    [...byUrl.keys()].sort(),
    ['bundle-rest', 'bundle-roots'],
    'residency is a property of the bundle',
  );
  const pending = collectPendingUrls(allPages, []);
  assert.deepEqual(
    pending.sort(),
    ['bundle-rest', 'bundle-roots'],
    'seven clusters cost two requests',
  );
  acceptPageArray(byUrl.get('bundle-rest')!, bundled.rest);
  acceptPageArray(byUrl.get('bundle-roots')!, bundled.roots);
  for (const rec of allPages) {
    assert.ok(rec.array, `${rec.url} not resident after its bundle arrived`);
    assert.equal(rec.array!.length, rec.triangles * 3);
    assert.deepEqual(
      [...rec.array!],
      [...(fixture.indices.get(rec.url) as Uint32Array)],
      `${rec.url} reads the wrong slice of its bundle`,
    );
  }
  const selected = selectVisiblePages(roots, cameraMoteur(wideCamera()), {
    pixelError: 0,
    viewport: [1280, 720],
    holdResident: true,
  });
  assert.deepEqual(selected.shown.map((page) => page.url).sort(), [
    'leaf0',
    'leaf1',
    'leaf2',
    'leaf3',
  ]);
  fixture.geometry.dispose();
});

test('only the root bundle resident still covers the surface once', () => {
  const fixture = dagFixture();
  const bundled = withBundles(fixture);
  const { roots, allPages, bootstrap } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    new Map(),
    fixture.associations,
    { allowMissing: true },
  );
  assert.deepEqual(
    bootstrap.map((page) => pageRequestUrl(page)),
    ['bundle-roots'],
  );
  acceptPageArray(indexPagesByUrl(allPages).get('bundle-roots')!, bundled.roots);
  const selected = selectVisiblePages(roots, cameraMoteur(wideCamera()), {
    pixelError: 0,
    viewport: [1280, 720],
    holdResident: true,
  });
  assert.deepEqual(
    selected.shown.map((page) => page.url),
    ['root'],
    'the pinned root covers the frame on its own',
  );
  assert.deepEqual(
    selected.wanted.map((page) => page.url).sort(),
    ['leaf0', 'leaf1', 'leaf2', 'leaf3'],
    'the finer cut keeps driving the streamer',
  );
  assert.ok(
    collectPendingUrls(selected.wanted, []).includes('bundle-rest'),
    'the missing bundle is what gets requested',
  );
  fixture.geometry.dispose();
});

test('a cut wider than the page budget is answered by a coarser cut, not by dropped clusters', () => {
  const fixture = dagFixture();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const full = selectVisiblePages(roots, cameraMoteur(wideCamera()), {
    pixelError: 0,
    viewport: [1280, 720],
    holdResident: true,
  });
  assert.equal(full.shown.length, 4);
  const tight = selectVisiblePages(roots, cameraMoteur(wideCamera()), {
    pixelError: 0,
    viewport: [1280, 720],
    holdResident: true,
    pageBudget: 3,
  });
  assert.ok(tight.shown.length <= 3);
  assertOneRepresentationPerGroup(tight.shown.map((page) => page.url));
  assert.ok(tight.pixelError > 0, 'the threshold was raised instead of truncating the cut');
  fixture.geometry.dispose();
});
