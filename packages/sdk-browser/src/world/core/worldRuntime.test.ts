import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { light } from '../../../../sdk-core/src/world/light/light.ts';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { createWorldNotices } from '../diagnostic/worldNotices.ts';
import { worldModelLoader } from './worldLoader.ts';
import { Scene } from './scene.ts';
import { createWorldRuntime } from './worldRuntime.ts';

// The example's own cache, served from disk; the GPU is the one thing this test has not.
const HOST = 'http://site.test/';
const SITE = new URL('../../../../../site/', import.meta.url);
const saved = { fetch: globalThis.fetch, location: Reflect.get(globalThis, 'location') };
const serve = async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  const path = fileURLToPath(new URL(url.slice(HOST.length), SITE));
  const json = /\.(json|gltf)$/.test(path);
  const type = json ? 'application/json' : 'application/octet-stream';
  return new Response(await readFile(path), { headers: { 'content-type': type } });
};
globalThis.fetch = serve as typeof fetch;
Reflect.set(globalThis, 'location', new URL(HOST));
Reflect.set(globalThis, 'ProgressEvent', globalThis.ProgressEvent ?? Event);
after(() => {
  globalThis.fetch = saved.fetch;
  Reflect.set(globalThis, 'location', saved.location);
});

/** A runtime on a canvas stand-in, whose every failure is handed to `failed`. */
const runtimeOf = (scene: Scene, ready: Promise<void>, failed: (error: unknown) => void) =>
  createWorldRuntime({
    canvas: { width: 1, height: 1 } as HTMLCanvasElement,
    scene,
    ready,
    camera: () => new Camera('perspective'),
    options: () => ({ manifestUrl: '' }),
    failed,
    opened: () => {},
    frame: () => {},
    drawn: () => false,
    display: () => ({ exposure: 1, toneMapping: 'aces' }),
    notices: createWorldNotices(),
  });
const until = async (done: () => boolean) => {
  for (let waited = 0; !done() && waited < 5000; waited += 20)
    await new Promise((resolve) => setTimeout(resolve, 20));
};

test('a model loaded after the lights still opens a session', async () => {
  const ready = Promise.resolve();
  const scene = new Scene(worldModelLoader(ready, undefined, () => 'webgpu'));
  let attempted = false;
  // A canvas stand-in makes the opening fail: that it was attempted is what is asserted.
  const runtime = runtimeOf(scene, ready, () => (attempted = true));
  // The lights alone open nothing; the model that follows must open the session.
  scene.add(light.directional({ intensity: 3 }), light.hemisphere({ intensity: 1 }));
  await scene.load(`${HOST}assets/examples/detail-by-pixel-error/cache/native/full/manifest.json`);
  await until(() => attempted);
  runtime.dispose();
  assert.equal(attempted, true);
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
  // The world is not stuck: the next mesh resolves, and a session opening is attempted.
  scene.add(object.mesh(geometry.box(2, 2, 2)));
  await until(() => failures.length > 1);
  await runtime.settled();
  runtime.dispose();
  assert.equal(failures.length, 2);
  assert.notEqual(failures[1], 'World scene resolution failed');
});
