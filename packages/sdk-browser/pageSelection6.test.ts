import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectClusterPages,
  selectVisiblePages,
  type PageRec,
  type SelectionResult,
} from './pageSelection.ts';
import { blendFixture, camera } from './pageSelectionBlendFixture.ts';
import { cameraMoteur } from './cameraFixture.ts';

test('a cut frame reuses its flat table, result and arrays: it allocates nothing', () => {
  const fixture = blendFixture();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const table = roots[0].table,
    shown: PageRec[] = [],
    wanted: PageRec[] = [];
  const result: SelectionResult<PageRec> = {
    shown,
    wanted,
    visible: 0,
    selectedTriangles: 0,
    displayedTriangles: 0,
    frustumRejected: 0,
    nodesTested: 0,
    lodLevel: 0,
    complete: true,
    pixelError: 0,
  };
  const cam = camera(),
    ask = {
      pixelError: 100,
      viewport: [960, 540] as [number, number],
      holdResident: true,
      wanted,
      result,
    };
  const first = selectVisiblePages(roots, cameraMoteur(cam), ask, shown);
  const second = selectVisiblePages(roots, cameraMoteur(cam), ask, shown);
  assert.equal(second, first, 'the returned result is the one supplied, frame after frame');
  assert.equal(second, result);
  assert.equal(second.shown, shown);
  assert.equal(second.wanted, wanted);
  assert.equal(
    roots[0].table,
    table,
    'la table plate est construite avec la primitive, jamais par image',
  );
  assert.deepEqual(
    second.shown.map((page) => page.url),
    ['near'],
  );
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('an invalid cluster band is rejected at prepare, not in the middle of a frame', () => {
  const fixture = blendFixture();
  // The own sphere is already validated at load; the replacement's was not validated anywhere.
  const page = fixture.metadata.primitives[0].pages[0] as {
    parentError: number | null;
    parentSphere: number[] | null;
  };
  page.parentError = 1;
  page.parentSphere = [0, 0, 0, -1];
  assert.throws(
    () =>
      collectClusterPages(fixture.source, fixture.metadata, fixture.indices, fixture.associations),
    /Invalid cluster parameters/,
  );
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('two successive calls with the same camera select the same set of clusters', () => {
  const fixture = blendFixture();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const cam = camera();
  const shown1: PageRec[] = [];
  const first = selectVisiblePages(
    roots,
    cameraMoteur(cam),
    { pixelError: 100, viewport: [960, 540], holdResident: true },
    shown1,
  );
  const shown2: PageRec[] = [];
  const second = selectVisiblePages(
    roots,
    cameraMoteur(cam),
    { pixelError: 100, viewport: [960, 540], holdResident: true },
    shown2,
  );
  assert.deepEqual(
    first.shown.map((p) => p.url),
    second.shown.map((p) => p.url),
    'same shown set',
  );
  assert.deepEqual(
    first.wanted.map((p) => p.url),
    second.wanted.map((p) => p.url),
    'same wanted set',
  );
  assert.equal(first.frustumRejected, second.frustumRejected, 'same frustum reject');
  assert.equal(first.lodLevel, second.lodLevel, 'same LOD level');
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('selection working arrays are reused from one frame to the next', () => {
  const fixture = blendFixture();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const cam = camera(),
    ask = {
      pixelError: 100,
      viewport: [960, 540] as [number, number],
      holdResident: true,
    };
  const hint: PageRec[] = [];
  const first = selectVisiblePages(roots, cameraMoteur(cam), ask, hint);
  const second = selectVisiblePages(roots, cameraMoteur(cam), ask, hint);
  assert.deepEqual(
    first.shown.map((p) => p.url),
    second.shown.map((p) => p.url),
    'same shown set',
  );
  assert.deepEqual(
    first.wanted.map((p) => p.url),
    second.wanted.map((p) => p.url),
    'same wanted set',
  );
  assert.equal(first.frustumRejected, second.frustumRejected, 'same frustum reject');
  fixture.geometry.dispose();
  fixture.material.dispose();
});
