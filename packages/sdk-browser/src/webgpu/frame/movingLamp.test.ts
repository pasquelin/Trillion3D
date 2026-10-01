// #1362: a lamp that moves asks no other lit program and redraws nothing of its own; the lamp
// examples' scenes open, their first frame lit by the program prepare compiled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore, type SceneLight } from '../../../../sdk-core/src/index.ts';
import { createDeferredLighting } from '../../lighting/deferred/deferred.ts';
import { directLightResources, litPrograms } from '../pages/prepare/contractLight.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { createAsIsShare } from '../../lighting/deferred/asIsShare.ts';
import { surface, view } from './hold.fixture.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

installGpuGlobals();

const POINT: SceneLight = {
  id: 'lamp',
  kind: 'point',
  position: [0, 2.5, 0],
  color: [1, 0.5, 0.2],
  intensity: 14,
  range: 6,
  castsShadow: false,
};
const lamps = (count: number, castsShadow: boolean) =>
  Array.from({ length: count }, (_, at) => ({ ...POINT, id: `lamp${at}`, castsShadow }));

/** The lights of the shipped lamp examples (`site/examples/`). */
const SCENES: Record<string, SceneLight[]> = {
  'a-lighthouse-beam': [
    {
      id: 'moon',
      kind: 'directional',
      direction: [0.5, -0.7, -0.5],
      color: [0.5, 0.6, 0.85],
      intensity: 2,
      castsShadow: true,
    },
    {
      id: 'beam',
      kind: 'spot',
      position: [0, 7.1, 0],
      direction: [1, -0.2, 0],
      color: [1, 0.95, 0.8],
      intensity: 6000,
      range: 60,
      coneAngle: 0.12,
      penumbra: 0.3,
      castsShadow: false,
    },
  ],
  'a-ring-of-lamps': lamps(32, false),
  'a-ring-of-lamps, shadows on': lamps(32, true),
};

/** A prepared session lighting `lights`: its tile lists and its shadow atlas in place. */
function lampScene(lights: SceneLight[]) {
  const store = createSceneLightStore();
  for (const light of lights) store.add(light);
  const rt = {
    lights: {
      store,
      buffer: {} as GPUBuffer,
      tiles: { wide: store.count > store.settings.tileLights, buffer: {} as GPUBuffer },
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

/** A fake device that counts every program it compiles, on the thread or off it. */
function countingDevice() {
  const { device } = fakeDevice();
  const compiles = { count: 0 };
  const off = device.createRenderPipelineAsync.bind(device),
    on = device.createRenderPipeline.bind(device);
  device.createRenderPipelineAsync = (descriptor) => (compiles.count++, off(descriptor));
  device.createRenderPipeline = (descriptor) => (compiles.count++, on(descriptor));
  return { device, compiles };
}

for (const [name, lights] of Object.entries(SCENES))
  test(`${name}: the scene opens, its first frame lit by the program prepare compiled`, async () => {
    const { rt } = lampScene(lights);
    const { device, compiles } = countingDevice();
    let redrawn = 0;
    const lighting = await createDeferredLighting(device, () => redrawn++, undefined, {
      ...litPrograms(rt),
    });
    await lighting.litReady;
    const prepared = compiles.count;
    // No shadow page drawn yet: no light holds a slot, and the frame asks the same program.
    const direct = directLightResources(rt);
    assert.equal(lighting.awaited(direct), undefined, 'the first frame is not held: it opens');
    lighting.bind(surface, view(), view(), true, direct);
    assert.equal(lighting.usesContract, true, 'lit at once');
    assert.equal(compiles.count, prepared, 'the first frame compiles nothing');
    assert.equal(redrawn, 0, 'nor waits for an arrival');
  });

test('a moving lamp asks no other program and redraws nothing, frame after frame', async () => {
  const { store, rt } = lampScene(SCENES['a-ring-of-lamps, shadows on']);
  const { device, compiles } = countingDevice();
  let redrawn = 0;
  const lighting = await createDeferredLighting(device, () => redrawn++, undefined, {
    ...litPrograms(rt),
  });
  await lighting.litReady;
  const prepared = compiles.count;
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
  assert.equal(compiles.count, prepared, 'no program compiled after prepare');
  assert.equal(redrawn, 0, 'no program landing asked a redraw');
  assert.equal(lighting.usesContract, true);
});

test('frame targets made again at another size compile their seed program once', async () => {
  const { device, compiles } = countingDevice();
  for (const [width, height] of [
    [1728, 1120],
    [3456, 2234],
    [1728, 1120],
  ])
    createAsIsShare(device, view(), width, height).dispose();
  await new Promise((done) => setImmediate(done));
  assert.equal(compiles.count, 1, 'one program, whatever the targets');
});
