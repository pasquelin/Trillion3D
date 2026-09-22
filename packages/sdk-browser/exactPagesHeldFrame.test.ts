// Three side: a held frame runs no cut. Its cut duration and visited-node count still
// equalled those of the last frame that had run one; they now equal zero. What the frame
// shows — retained pages, selected triangles, frustum rejection — stays that of the
// redisplayed cut.
import test from 'node:test';
import assert from 'node:assert/strict';
import { exactPagesBackend } from './measurement.ts';
import { quadRootsContext, frontCamera } from './pagesBackendScenes.ts';

function engine() {
  const { geometry, material, context } = quadRootsContext(true);
  return {
    backend: exactPagesBackend(context),
    camera: frontCamera(),
    dispose: () => (geometry.dispose(), material.dispose()),
  };
}

test('still pose: the frame ends up held, and the cut it shows does not move', () => {
  const { backend, camera, dispose } = engine();
  backend.render(camera);
  const premiere = backend.metrics();
  assert.equal(premiere.frameHeld, false, 'the first frame does all the work');
  let tenue;
  for (let i = 0; i < 4 && !tenue; i++) {
    backend.render(camera);
    const m = backend.metrics();
    if (m.frameHeld) tenue = m;
  }
  assert.ok(tenue, 'a still pose never converged to a held frame');
  assert.equal(tenue.clusters, premiere.clusters, 'the redisplayed cut is the same');
  assert.equal(tenue.selectedTriangles, premiere.selectedTriangles);
  assert.equal(tenue.frustumRejected, premiere.frustumRejected);
  assert.equal(tenue.lodLevel, premiere.lodLevel);
  backend.dispose();
  dispose();
});

test('a held frame does not republish the cut duration of the frame that ran one', () => {
  const { backend, camera, dispose } = engine();
  let tenue;
  for (let i = 0; i < 5 && !tenue; i++) {
    backend.render(camera);
    const m = backend.metrics();
    if (m.frameHeld) tenue = m;
  }
  assert.ok(tenue, 'no held frame');
  assert.equal(tenue.cpuSelectMs, 0, 'no cut ran on this frame');
  assert.equal(tenue.cpuSelectNodesTested, 0, 'no node was visited');
  backend.dispose();
  dispose();
});
