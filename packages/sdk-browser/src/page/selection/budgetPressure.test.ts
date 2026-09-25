import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineError } from '../../../../sdk-core/src/index.ts';
import { collectClusterPages, rootCoverage, selectVisiblePages } from './selection.ts';
import { dagFixture, wideCamera } from './dag.fixture.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';

test('budget pressure down to the pinned roots still draws the surface once, by the root', () => {
  const cam = wideCamera(),
    viewport: [number, number] = [1280, 720];
  const fixture = dagFixture();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  // Budget pressure evicted every intermediate level: only the pinned roots are resident. The cut
  // rule draws the nearest resident ancestor of what is missing: the root, once.
  const pinned = new Set(rootCoverage(roots).map((page) => page.url));
  assert.deepEqual([...pinned], ['root']);
  const starved = selectVisiblePages(roots, cameraMoteur(cam), {
    pixelError: 0,
    viewport,
    holdResident: true,
    isResident: (rec) => pinned.has(rec.url),
  });
  assert.equal(starved.complete, false, 'the requested cut is not resident');
  assert.deepEqual(
    starved.shown.map((page) => page.url),
    ['root'],
  );
  // The wanted cut is untouched, so streaming still asks the detail back.
  assert.deepEqual(starved.wanted.map((page) => page.url).sort(), [
    'leaf0',
    'leaf1',
    'leaf2',
    'leaf3',
  ]);
  fixture.geometry.dispose();
});

test('a primitive whose clusters carry no DAG error band is refused by name, not half-read', () => {
  const fixture = dagFixture();
  for (const page of fixture.metadata.primitives[0].pages)
    delete (page as { lodError?: number }).lodError;
  assert.throws(
    () =>
      collectClusterPages(fixture.source, fixture.metadata, fixture.indices, fixture.associations),
    (error: unknown) =>
      error instanceof EngineError &&
      error.code === 'STALE_CACHE' &&
      /without a DAG error band/.test(error.message),
  );
  fixture.geometry.dispose();
});
