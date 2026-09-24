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
 * `gate` holds the opening so lights can land while it is in flight. `seatedFirst` says whether
 * that first frame seated a finished resolution — the seat epoch the physics placer reads moved.
 */
async function lightsAfterLoad(addLights: (scene: Scene, opening: Promise<void>) => Promise<void>) {
  const ready = Promise.resolve();
  const scene = new Scene(worldModelLoader(ready, undefined, () => 'webgpu'));
  const { session, written } = sessionStandIn();
  let release = () => {};
  const gate = new Promise<void>((done) => (release = done));
  let entered = () => {};
  const opening = new Promise<void>((done) => (entered = done));
  let seatedFirst = false;
  const open = (async () => {
    entered();
    await gate;
    const epoch = scene._link?.seatEpoch?.();
    runtime.beforeFrame(); // the first interactive frame, drawn inside the opening
    seatedFirst = scene._link?.seatEpoch?.() !== epoch;
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
  return { written, seatedFirst };
}

const assertLit = ({ written }: Awaited<ReturnType<typeof lightsAfterLoad>>) => {
  assert.equal(written.view, 'lit');
  assert.deepEqual(
    written.lights.map((record) => record.kind),
    ['directional', 'directional'],
  );
  assert.ok(written.irradiance, 'the hemisphere reaches the environment');
};

test('lights added right after a compiled model loads reach its session', async () => {
  const lit = await lightsAfterLoad(async (scene, opening) => {
    scene.add(...lightsOf());
    await opening;
  });
  assertLit(lit);
});

test('lights resolved while the session opens survive its first frame', async () => {
  const lit = await lightsAfterLoad(async (scene, opening) => {
    await opening;
    scene.add(...lightsOf());
    // Lights read no resource: their resolution runs on microtasks alone, drained by the next turn.
    await new Promise(setImmediate);
  });
  // The case's own precondition: the sessionless first frame seated the lights' resolution.
  assert.ok(lit.seatedFirst, 'the lights resolved before the opening drew its first frame');
  assertLit(lit);
});
