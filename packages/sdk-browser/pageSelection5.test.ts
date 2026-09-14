import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineError } from '../sdk-core/index.ts';
import { collectClusterPages, rootCoverage, selectVisiblePages } from './pageSelection.ts';
import { dagFixture, wideCamera } from './pageSelectionDagFixture.ts';

test('budget pressure down to the pinned roots still publishes a complete, coarser cut', () => {
  const cam = wideCamera(),
    viewport: [number, number] = [1280, 720];
  const fixture = dagFixture();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  // A budget below the finest cut answers with the next coarser complete cover, at its own threshold.
  const tight = selectVisiblePages(roots, cam, {
    pixelError: 0,
    viewport,
    frame: 1,
    holdResident: true,
    pageBudget: 3,
  });
  assert.deepEqual(tight.shown.map((page) => page.url).sort(), ['mid-left', 'mid-right']);
  assert.ok(tight.pixelError > 0);
  assert.equal(tight.complete, true);
  // Budget pressure evicted every intermediate level: only the pinned roots are resident. The cut
  // published must still cover the surface once rather than report an incomplete frame.
  const pinned = new Set(rootCoverage(roots).map((page) => page.url));
  assert.deepEqual([...pinned], ['root']);
  const starved = selectVisiblePages(roots, cam, {
    pixelError: 0,
    viewport,
    frame: 2,
    holdResident: true,
    rootFallback: true,
    isResident: (rec) => pinned.has(rec.url),
  });
  assert.equal(starved.complete, true, 'the pinned root cover leaves no hole');
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
