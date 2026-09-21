import test from 'node:test';
import assert from 'node:assert/strict';
import { exactPagesBackend } from './index.ts';
import { frontCamera, quadRootsContext } from './pagesBackendScenes.ts';
import { submittedDraws } from './clusterBatchMesh.ts';

test('exact pages attach accepted pages in the same frame without a second frustum walk', () => {
  const { geometry, material, context } = quadRootsContext(false, { maxResidentPages: 2 });
  const backend = exactPagesBackend(context);
  const camera = frontCamera();
  backend.render(camera);
  backend.acceptPage?.('0', new Uint32Array([0, 1, 2]));
  backend.syncResident?.();
  assert.equal(backend.metrics().residentPages, 1);
  backend.acceptPage?.('1', new Uint32Array([0, 2, 3]));
  backend.syncResident?.();
  assert.equal(backend.metrics().residentPages, 2);
  assert.equal(submittedDraws(backend).length, 1);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('exact pages stream selected clusters: pending URLs attach on acceptPage', () => {
  const { geometry, material, context } = quadRootsContext(false, { maxResidentPages: 2 });
  const backend = exactPagesBackend(context);
  const camera = frontCamera();
  backend.render(camera);
  assert.equal(backend.metrics().clusters, 2);
  assert.equal(backend.metrics().residentPages, 0);
  assert.deepEqual(backend.pendingUrls?.().sort(), ['0', '1']);
  backend.acceptPage?.('0', new Uint32Array([0, 1, 2]));
  backend.render(camera);
  assert.equal(backend.metrics().residentPages, 1);
  assert.deepEqual(backend.pendingUrls?.(), ['1']);
  backend.acceptPage?.('1', new Uint32Array([0, 2, 3]));
  backend.render(camera);
  assert.equal(backend.metrics().residentPages, 2);
  assert.deepEqual(backend.pendingUrls?.(), []);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('a primitive whose clusters are all roots selects every one of them', () => {
  const { geometry, material, context } = quadRootsContext(true, { maxResidentPages: 2 });
  const backend = exactPagesBackend(context);
  const camera = frontCamera();
  backend.render(camera);
  assert.equal(backend.metrics().clusters, 2);
  assert.equal(backend.metrics().residentPages, 2);
  assert.equal(backend.metrics().selectedTriangles, 2);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});
