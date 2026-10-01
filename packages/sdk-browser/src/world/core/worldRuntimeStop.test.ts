import assert from 'node:assert/strict';
import test from 'node:test';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { worldModelLoader } from './worldLoader.ts';
import { Scene } from './scene.ts';
import { runtimeOf, sessionStandIn, type Open } from './worldRuntime.fixture.ts';

test('logical world stop detaches mutations and drawing while physical release is pending', async () => {
  const ready = Promise.resolve();
  const scene = new Scene(worldModelLoader(ready, undefined, () => 'webgpu'));
  const { session } = sessionStandIn();
  let opens = 0,
    releases = 0,
    frames = 0,
    invalidations = 0;
  const originalRender = session.render;
  session.render = () => {
    frames++;
    return originalRender();
  };
  session.invalidate = () => {
    invalidations++;
  };
  session.dispose = () => {
    releases++;
  };
  const open = (async () => {
    opens++;
    return session;
  }) as unknown as Open;
  const runtime = runtimeOf(scene, ready, (error) => assert.fail(String(error)), open);
  scene.add(object.mesh(geometry.box(1, 1, 1)));
  await runtime.settled();
  runtime.render();
  const before = { opens, frames, invalidations };
  runtime.stop();
  scene.add(object.mesh(geometry.box(2, 2, 2)));
  runtime.beforeFrame();
  runtime.invalidate();
  assert.equal(runtime.render(), null);
  await runtime.settled();
  assert.deepEqual({ opens, frames, invalidations }, before);
  assert.equal(releases, 0, 'GPU consumers may still be releasing asynchronously');
  runtime.dispose();
  assert.equal(releases, 1);
});
