import assert from 'node:assert/strict';
import { test } from 'node:test';
import { light } from '../../../../sdk-core/src/world/light/light.ts';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { worldModelLoader } from './worldLoader.ts';
import { Scene } from './scene.ts';
import { HOST, runtimeOf, sessionStandIn, until, type Open } from './worldRuntime.fixture.ts';

test('a model loaded after the lights still opens a session', async () => {
  const ready = Promise.resolve();
  const scene = new Scene(worldModelLoader(ready, undefined, () => 'webgpu'));
  let attempted = false;
  const said: string[] = [];
  // A canvas stand-in makes the opening fail: that it was attempted is what is asserted.
  const runtime = runtimeOf(
    scene,
    ready,
    () => ((attempted = true), said.push('failed')),
    undefined,
    () => said.push('opening'),
  );
  // The lights alone open nothing; the model that follows must open the session.
  scene.add(light.directional({ intensity: 3 }), light.hemisphere({ intensity: 1 }));
  await scene.load(`${HOST}assets/examples/detail-by-pixel-error/cache/native/full/manifest.json`);
  await until(() => attempted);
  runtime.dispose();
  assert.equal(attempted, true);
  // Every opening, the lights' included, first clears the failure a previous one left.
  assert.equal(said.at(-1), 'failed');
  assert.equal(said.at(-2), 'opening');
});

test('a resolution that throws is reported, and the next change resolves again', async () => {
  const ready = Promise.resolve();
  const scene = new Scene(worldModelLoader(ready, undefined, () => 'webgpu'));
  const failures: string[] = [];
  const runtime = runtimeOf(scene, ready, (error) => failures.push((error as Error).message));
  // A page served over plain http on a LAN address has no `crypto.subtle`: the digest throws.
  const digest = crypto.subtle.digest;
  crypto.subtle.digest = () => Promise.reject(new Error('crypto.subtle is unavailable'));
  scene.add(object.mesh(geometry.box(1, 1, 1)));
  await until(() => failures.length > 0);
  crypto.subtle.digest = digest;
  assert.deepEqual(failures, ['World scene resolution failed']);
  // The world is not stuck: the next change — an empty group, nothing to draw of its own —
  // resolves the mesh that failed, and a session opening is attempted for it.
  scene.add(object.group());
  await until(() => failures.length > 1);
  await runtime.settled();
  runtime.dispose();
  assert.equal(failures.length, 2);
  assert.notEqual(failures[1], 'World scene resolution failed');
});

test('a light added with a resolution that throws is still written to the open session', async () => {
  const ready = Promise.resolve();
  const scene = new Scene(worldModelLoader(ready, undefined, () => 'webgpu'));
  const { session, written } = sessionStandIn();
  const open = (async () => session) as unknown as Open;
  const failures: string[] = [];
  const runtime = runtimeOf(scene, ready, (error) => failures.push((error as Error).message), open);
  scene.add(object.mesh(geometry.box(1, 1, 1)));
  await runtime.settled();
  assert.equal(runtime.explorer, session);
  runtime.render();
  written.lights.length = 0;
  // The light enters with a mesh whose resolution throws: the burst fails, the light is kept.
  const digest = crypto.subtle.digest;
  crypto.subtle.digest = () => Promise.reject(new Error('crypto.subtle is unavailable'));
  scene.add(light.point({ intensity: 3 }), object.mesh(geometry.box(2, 2, 2)));
  await until(() => failures.length > 0);
  crypto.subtle.digest = digest;
  runtime.render();
  runtime.dispose();
  assert.deepEqual(failures, ['World scene resolution failed']);
  assert.equal(written.lights.length, 1);
});

test('a scene change with nothing to draw does not stop the next one from opening a session', async () => {
  const scene = new Scene(() => Promise.reject(new Error('no loader')));
  const openings: unknown[] = [];
  // Node has no GPU: a session asked for fails to open, which is how the attempt is seen.
  const runtime = runtimeOf(scene, Promise.resolve(), (error) => openings.push(error));
  // A page sets its background before its model arrives: that change has nothing to open.
  scene.background = null;
  await new Promise((done) => setTimeout(done, 10));
  assert.equal(openings.length, 0);
  scene.add(object.mesh(geometry.box()));
  await until(() => openings.length > 0);
  runtime.dispose();
  assert.equal(openings.length, 1, 'the mesh asks for a session');
});
