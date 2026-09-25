// The fog contract (#345): the environment carries it into the GPU block behind the irradiance,
// a fog changed stales the frame, the same fog set again does not, and a fog out of range is
// refused by name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { ENVIRONMENT_COEFFICIENTS, SCENE_ENVIRONMENT_FLOATS } from './environment.ts';
import { FOG_MODE, SCENE_FOG_FLOATS, validateSceneFog } from './fog.ts';

const GREY = [0.5, 0.5, 0.5] as const;

test('the fog block follows the irradiance: colour and mode, then the law', () => {
  assert.equal(SCENE_ENVIRONMENT_FLOATS, ENVIRONMENT_COEFFICIENTS * 4 + SCENE_FOG_FLOATS);
  const store = createSceneLightStore();
  const block = () => Array.from(store.environmentPacked.subarray(36, 44));
  store.setEnvironment({ exposure: 1, fog: { color: GREY, near: 3, far: 30 } });
  assert.deepEqual(block(), [0.5, 0.5, 0.5, FOG_MODE.linear, 3, 30, 0, 0]);
  store.setEnvironment({ exposure: 1, fog: { color: GREY, density: 0.25, heightFalloff: 0.5 } });
  assert.deepEqual(block(), [0.5, 0.5, 0.5, FOG_MODE.exponential, 0.25, 0.5, 0, 0]);
  store.setEnvironment({ exposure: 1 });
  assert.deepEqual(block(), [0, 0, 0, FOG_MODE.none, 0, 0, 0, 0]);
});

test('a fog changed stales the frame; the same fog set again does not', () => {
  const store = createSceneLightStore();
  store.setEnvironment({ exposure: 1, fog: { color: GREY, near: 3, far: 30 } });
  const epoch = store.epoch;
  store.setEnvironment({ exposure: 1, fog: { color: [0.5, 0.5, 0.5], near: 3, far: 30 } });
  assert.equal(store.epoch, epoch);
  store.setEnvironment({ exposure: 1, fog: { color: GREY, near: 3, far: 31 } });
  assert.equal(store.epoch, epoch + 1);
  store.setEnvironment({ exposure: 1 });
  assert.equal(store.epoch, epoch + 2);
});

test('a change of fog alone leaves light transport, and the bounce probes, as they were', () => {
  const store = createSceneLightStore();
  store.setEnvironment({ exposure: 1 });
  const transport = store.transportEpoch;
  store.setEnvironment({ exposure: 1, fog: { color: GREY, density: 0.1 } });
  store.setEnvironment({ exposure: 1, fog: { color: GREY, near: 3, far: 30 } });
  store.setEnvironment({ exposure: 1 });
  assert.equal(store.transportEpoch, transport);
  store.setEnvironment({ exposure: 1, irradiance: Array(27).fill(0.1) });
  assert.equal(store.transportEpoch, transport + 1);
  store.add({
    id: 'sun',
    kind: 'directional',
    direction: [0, -1, 0],
    color: [1, 1, 1],
    intensity: 1,
    castsShadow: false,
  });
  assert.equal(store.transportEpoch, transport + 2);
});

test('a fog out of range is refused by name', () => {
  const refused = (fog: unknown) =>
    assert.throws(() => validateSceneFog(fog as never), { code: 'INVALID_SCENE_ENVIRONMENT' });
  refused({ color: GREY, near: 5, far: 5 });
  refused({ color: GREY, near: -1, far: 5 });
  refused({ color: [1, 1], near: 0, far: 5 });
  refused({ color: [-1, 0, 0], density: 1 });
  refused({ color: GREY, density: Number.NaN });
  refused({ color: GREY, density: 1, heightFalloff: -0.1 });
  refused({ color: GREY, density: 1, baseHeight: Infinity });
  assert.deepEqual(validateSceneFog({ color: GREY, density: 0 }), {
    color: [0.5, 0.5, 0.5],
    density: 0,
    heightFalloff: 0,
    baseHeight: 0,
  });
});
