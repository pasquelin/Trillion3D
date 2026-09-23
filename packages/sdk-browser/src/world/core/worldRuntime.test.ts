import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { light } from '../../../../sdk-core/src/world/light/light.ts';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { createWorldNotices } from '../diagnostic/worldNotices.ts';
import { worldModelLoader } from './loadedModel.ts';
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

test('a model loaded after the lights still opens a session', async () => {
  const ready = Promise.resolve();
  const scene = new Scene(worldModelLoader(ready, () => 'webgpu', undefined));
  let attempted = false;
  const runtime = createWorldRuntime({
    canvas: { width: 1, height: 1 } as HTMLCanvasElement,
    scene,
    ready,
    camera: () => new Camera('perspective'),
    options: () => ({ manifestUrl: '' }),
    // A canvas stand-in makes the opening fail: that it was attempted is what is asserted.
    failed: () => (attempted = true),
    opened: () => {},
    frame: () => {},
    drawn: () => false,
    display: () => ({ exposure: 1, toneMapping: 'aces' }),
    notices: createWorldNotices(),
  });
  // The lights alone open nothing; the model that follows must open the session.
  scene.add(light.directional({ intensity: 3 }), light.hemisphere({ intensity: 1 }));
  await scene.load(`${HOST}assets/examples/detail-by-pixel-error/cache/native/full/manifest.json`);
  for (let waited = 0; !attempted && waited < 5000; waited += 20)
    await new Promise((resolve) => setTimeout(resolve, 20));
  runtime.dispose();
  assert.equal(attempted, true);
});
