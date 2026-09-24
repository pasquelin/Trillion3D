import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { light } from '../../../../sdk-core/src/world/light/light.ts';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { box } from '../../../../sdk-core/src/world/geometry/basic.ts';
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
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

/** A runtime over `scene` on a canvas stand-in, whose failed openings `failed` hears. */
const runtimeOn = (scene: Scene, failed: (error: unknown) => unknown, opening = () => {}) =>
  createWorldRuntime({
    canvas: { width: 1, height: 1 } as HTMLCanvasElement,
    scene,
    ready: Promise.resolve(),
    camera: () => new Camera('perspective'),
    options: () => ({ manifestUrl: '' }),
    opened: () => {},
    frame: () => {},
    drawn: () => false,
    display: () => ({ exposure: 1, toneMapping: 'aces' }),
    diagnostic: { notices: createWorldNotices(), failed, opening },
  });

test('a model loaded after the lights still opens a session', async () => {
  const ready = Promise.resolve();
  const scene = new Scene(worldModelLoader(ready, undefined, () => 'webgpu'));
  let attempted = false;
  const said: string[] = [];
  // A canvas stand-in makes the opening fail: that it was attempted is what is asserted.
  const runtime = runtimeOn(
    scene,
    () => ((attempted = true), said.push('failed')),
    () => said.push('opening'),
  );
  // The lights alone open nothing; the model that follows must open the session.
  scene.add(light.directional({ intensity: 3 }), light.hemisphere({ intensity: 1 }));
  await scene.load(`${HOST}assets/examples/detail-by-pixel-error/cache/native/full/manifest.json`);
  for (let waited = 0; !attempted && waited < 5000; waited += 20)
    await new Promise((resolve) => setTimeout(resolve, 20));
  runtime.dispose();
  assert.equal(attempted, true);
  // Every opening, the lights' included, first clears the failure a previous one left.
  assert.equal(said.at(-1), 'failed');
  assert.equal(said.at(-2), 'opening');
});

test('a scene change with nothing to draw does not stop the next one from opening a session', async () => {
  const scene = new Scene(() => Promise.reject(new Error('no loader')));
  const openings: unknown[] = [];
  // Node has no GPU: a session asked for fails to open, which is how the attempt is seen.
  const runtime = runtimeOn(scene, (error) => openings.push(error));
  // A page sets its background before its model arrives: that change has nothing to open.
  const turn = () => new Promise((done) => setTimeout(done, 10));
  scene.background = null;
  await turn();
  assert.equal(openings.length, 0);
  scene.add(new Mesh(box()));
  for (let wait = 0; wait < 100 && !openings.length; wait++) await turn();
  runtime.dispose();
  assert.equal(openings.length, 1, 'the mesh asks for a session');
});
