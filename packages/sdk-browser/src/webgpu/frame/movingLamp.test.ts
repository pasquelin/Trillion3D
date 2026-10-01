// #1362: a lamp that moves asks no other lit program and redraws nothing of its own; the lamp
// examples' scenes open, their first frame lit by the program prepare compiled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore, type SceneLight } from '../../../../sdk-core/src/index.ts';
import { LAMP_SCENES } from './lampScenes.fixture.ts';
import { createDeferredLighting } from '../../lighting/deferred/deferred.ts';
import { directLightResources, litPrograms } from '../pages/prepare/contractLight.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { createAsIsShare } from '../../lighting/deferred/asIsShare.ts';
import { surface, view } from './hold.fixture.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

installGpuGlobals();

/** A prepared session lighting `lights`: its tile lists and its shadow atlas in place. */
function lampScene(lights: SceneLight[]) {
  const store = createSceneLightStore();
  for (const light of lights) store.add(light);
  const rt = {
    lights: {
      store,
      buffer: {} as GPUBuffer,
      tiles: { buffer: {} as GPUBuffer },
      shadows: { dataBuffer: {} as GPUBuffer, view: {} as GPUTextureView },
    },
    bounce: { wanted: false },
    sunFar: {},
    vis: {},
    gpu: {},
    context: {},
    diag: { diagnosticFailure: () => {} },
  } as unknown as WebgpuPagesRuntime;
  return { store, rt };
}

/** That session prepared: its lit programs compiled as prepare does, a landing counted. */
async function preparedLamps(lights: SceneLight[]) {
  const { store, rt } = lampScene(lights);
  // Every program the device compiles, on the thread or off it.
  const { device, renderPipelines: compiles } = fakeDevice();
  const landed = { count: 0 };
  const lighting = await createDeferredLighting(
    device,
    () => landed.count++,
    undefined,
    litPrograms(rt),
  );
  await lighting.litReady;
  return { store, rt, lighting, compiles, prepared: compiles.length, landed };
}

for (const [name, lights] of Object.entries(LAMP_SCENES))
  test(`${name}: the scene opens, its first frame lit by the program prepare compiled`, async () => {
    const { rt, lighting, compiles, prepared, landed } = await preparedLamps(lights);
    // No shadow page drawn yet: no light holds a slot, and the frame asks the same program.
    const direct = directLightResources(rt);
    assert.equal(lighting.awaited(direct), undefined, 'the first frame is not held: it opens');
    lighting.bind(surface, view(), view(), true, direct);
    assert.equal(lighting.usesContract, true, 'lit at once');
    // A compile the frame started would have reached the device by now.
    await new Promise((done) => setImmediate(done));
    assert.equal(compiles.length, prepared, 'the first frame compiles nothing');
    assert.equal(landed.count, 0, 'nor waits for an arrival');
  });

test('a moving lamp asks no other program and redraws nothing, frame after frame', async () => {
  const { store, rt, lighting, compiles, prepared, landed } = await preparedLamps(
    LAMP_SCENES['a-ring-of-lamps, shadows on'],
  );
  for (let frame = 0; frame < 120; frame++) {
    const angle = frame * 0.05;
    store.set('lamp0', { position: [Math.cos(angle) * 2, 2.5, Math.sin(angle) * 2] });
    // Its shadow page comes and goes as it moves: slot one frame, none the next.
    store.assignSlice(0, frame % 2 ? -1 : 0);
    const direct = directLightResources(rt);
    assert.equal(lighting.awaited(direct), undefined);
    lighting.bind(surface, view(), view(), true, direct);
  }
  await new Promise((done) => setImmediate(done));
  assert.equal(compiles.length, prepared, 'no program compiled after prepare');
  assert.equal(landed.count, 0, 'no program landing asked a redraw');
  assert.equal(lighting.usesContract, true);
});

test('frame targets made again at another size compile their seed program once', async () => {
  const { device, renderPipelines: compiles } = fakeDevice();
  for (const [width, height] of [
    [1728, 1120],
    [3456, 2234],
    [1728, 1120],
  ])
    createAsIsShare(device, view(), width, height).dispose();
  await new Promise((done) => setImmediate(done));
  assert.equal(compiles.length, 1, 'one program, whatever the targets');
});
