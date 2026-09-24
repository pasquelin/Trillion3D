import assert from 'node:assert/strict';
import { test } from 'node:test';
import { light } from '../../../../sdk-core/src/world/light/light.ts';
import { worldModelLoader } from './worldLoader.ts';
import { Scene } from './scene.ts';
import { HOST, runtimeOf, sessionStandIn, type Open } from './worldRuntime.fixture.ts';

const MODEL = `${HOST}assets/examples/a-model-from-obj/cache/native/full/manifest.json`;
const lightsOf = () => [
  light.directional({ intensity: 3.4, castShadow: true }),
  light.directional({ intensity: 1.1, position: [-3, 2, -4] }),
  light.hemisphere({ intensity: 0.6 }),
];

/**
 * A compiled model loaded, then its lights added (#370). The stand-in opening draws its first
 * frame before it returns, as `openMeasuredWorld` does, while the runtime holds no session yet;
 * `gate` holds the opening so lights can land while it is in flight.
 */
async function lightsAfterLoad(addLights: (scene: Scene, opening: Promise<void>) => Promise<void>) {
  const ready = Promise.resolve();
  const scene = new Scene(worldModelLoader(ready, undefined, () => 'webgpu'));
  const { session, written } = sessionStandIn();
  let release = () => {};
  const gate = new Promise<void>((done) => (release = done));
  let entered = () => {};
  const opening = new Promise<void>((done) => (entered = done));
  const open = (async () => {
    entered();
    await gate;
    runtime.beforeFrame(); // the first interactive frame, drawn inside the opening
    return session;
  }) as unknown as Open;
  const failures: unknown[] = [];
  const runtime = runtimeOf(scene, ready, (error) => failures.push(error), open);
  await scene.load(MODEL);
  await addLights(scene, opening);
  release();
  await runtime.settled();
  runtime.render();
  runtime.dispose();
  assert.deepEqual(failures, []);
  return written;
}

const assertLit = (written: ReturnType<typeof sessionStandIn>['written']) => {
  assert.equal(written.view, 'lit');
  assert.deepEqual(
    written.lights.map((record) => record.kind),
    ['directional', 'directional'],
  );
  assert.ok(written.irradiance, 'the hemisphere reaches the environment');
};

test('lights added right after a compiled model loads reach its session', async () => {
  const written = await lightsAfterLoad(async (scene, opening) => {
    scene.add(...lightsOf());
    await opening;
  });
  assertLit(written);
});

test('lights resolved while the session opens survive its first frame', async () => {
  const written = await lightsAfterLoad(async (scene, opening) => {
    await opening;
    scene.add(...lightsOf());
    // Their resolution ends before the opening draws the frame that holds no session yet.
    await new Promise((done) => setTimeout(done, 50));
  });
  assertLit(written);
});
