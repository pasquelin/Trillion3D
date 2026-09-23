import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { collectClusterPages, rootCoverage, selectVisiblePages } from './selection.ts';
import { dagFixture, wideCamera, urls } from './dag.fixture.ts';
import { assertOneRepresentationPerGroup } from './helpers.fixture.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';

test('a flat cluster cut selects exactly one level per chain and covers the surface once', () => {
  const fixture = dagFixture();
  assert.deepEqual(urls(fixture, 0), ['leaf0', 'leaf1', 'leaf2', 'leaf3']);
  assert.deepEqual(urls(fixture, 8), ['mid-left', 'mid-right']);
  assert.deepEqual(urls(fixture, 200), ['root']);
  // Every threshold keeps exactly one cluster of each leaf-to-root chain.
  const chains = [
    ['leaf0', 'mid-left', 'root'],
    ['leaf1', 'mid-left', 'root'],
    ['leaf2', 'mid-right', 'root'],
    ['leaf3', 'mid-right', 'root'],
  ];
  for (const pixelError of [0, 1, 4, 7.4, 7.6, 20, 138, 139, 1e6]) {
    const shown = new Set(urls(fixture, pixelError));
    for (const chain of chains)
      assert.equal(
        chain.filter((url) => shown.has(url)).length,
        1,
        `pixelError ${pixelError}: ${chain.join('>')}`,
      );
  }
  fixture.geometry.dispose();
});

test('a flat cluster cut keeps the frustum cut and reports the root cover', () => {
  const fixture = dagFixture();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  assert.deepEqual(
    rootCoverage(roots).map((page) => page.url),
    ['root'],
  );
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
  cam.position.set(-1.5, 0, 2);
  cam.lookAt(-1.5, 0, 0);
  cam.updateMatrixWorld();
  const selected = selectVisiblePages(roots, cameraMoteur(cam), {
    pixelError: 0,
    viewport: [1280, 720],
    holdResident: true,
  });
  assert.deepEqual(selected.shown.map((page) => page.url).sort(), ['leaf0', 'leaf1']);
  assert.ok(selected.frustumRejected > 0);
  fixture.geometry.dispose();
});

/** The exact wide-camera cut of the test DAG once `missing` clusters are gone from the cache. */
function cutWithout(...missing: string[]) {
  const fixture = dagFixture();
  for (const url of missing) fixture.indices.delete(url);
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
    { allowMissing: true },
  );
  const selected = selectVisiblePages(roots, cameraMoteur(wideCamera()), {
    pixelError: 0,
    viewport: [1280, 720],
    holdResident: true,
  });
  const shown = selected.shown.map((page) => page.url).sort();
  return { fixture, selected, shown };
}

test('a missing cluster steps its whole group back to the coarse representation, never leaving a hole', () => {
  const { fixture, selected, shown } = cutWithout('leaf0');
  assert.deepEqual(
    shown,
    ['leaf2', 'leaf3', 'mid-left'],
    'the left half falls back, the right half stays fine',
  );
  assertOneRepresentationPerGroup(shown);
  assert.deepEqual(
    selected.wanted.map((page) => page.url).sort(),
    ['leaf0', 'leaf1', 'leaf2', 'leaf3'],
    'the finer cut is still requested',
  );
  assert.equal(
    selected.complete,
    false,
    'the cut is not resident yet, even though the frame has no hole',
  );
  assert.equal(selected.displayedTriangles, 3, 'every displayed cluster is drawable');
  fixture.geometry.dispose();
});

test('a missing coarse cluster keeps stepping back until the pinned root covers everything', () => {
  const { fixture, shown } = cutWithout('leaf0', 'mid-left');
  assert.deepEqual(shown, ['root'], 'the whole primitive falls back to its root');
  assertOneRepresentationPerGroup(shown);
  fixture.geometry.dispose();
});

test('the fallback covers the surface once for every residency pattern', () => {
  const urlsByBit = ['leaf0', 'leaf1', 'leaf2', 'leaf3', 'mid-left', 'mid-right'];
  for (let mask = 0; mask < 64; mask++) {
    const fixture = dagFixture();
    for (let bit = 0; bit < urlsByBit.length; bit++)
      if (mask & (1 << bit)) fixture.indices.delete(urlsByBit[bit]);
    const { roots } = collectClusterPages(
      fixture.source,
      fixture.metadata,
      fixture.indices,
      fixture.associations,
      { allowMissing: true },
    );
    for (const pixelError of [0, 4, 20]) {
      const selected = selectVisiblePages(roots, cameraMoteur(wideCamera()), {
        pixelError,
        viewport: [1280, 720],
        holdResident: true,
      });
      const shown = selected.shown.map((page) => page.url).sort();
      assert.ok(shown.length > 0, `mask ${mask} px ${pixelError}: nothing drawn`);
      assertOneRepresentationPerGroup(shown);
      assert.ok(
        selected.shown.every((page) => !!page.array),
        `mask ${mask}: a missing page was drawn`,
      );
    }
    fixture.geometry.dispose();
  }
});
