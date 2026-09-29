import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuLightState } from '../pages/state/lights.ts';
import { encodeDirectLights } from '../pages/render/encodeLights.ts';
import { settledRt } from '../frame/hold.fixture.ts';
import type { SceneLight } from '../../../../sdk-core/src/index.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';

installGpuGlobals();

const SUN: SceneLight = {
  id: 'sun',
  kind: 'directional',
  direction: [0, -1, 0],
  color: [1, 1, 1],
  intensity: 1,
  castsShadow: true,
};
const CAM = { eye: [0, 5, 0] };

// #1016 review: the still average restarts on a page drawn this image (`keepWebgpuFrame`); an
// unlit view drew none, and must not keep the count of the last lit image, or it never holds.
test('an unlit image counts no shadow page of an earlier image', () => {
  const rt = settledRt();
  const lights = createWebgpuLightState(32);
  (rt as unknown as { lights: unknown }).lights = lights;
  lights.store.add(SUN);
  lights.shadowPages = 12;
  lights.store.setView('unlit');
  encodeDirectLights(
    rt,
    undefined as never,
    undefined as never,
    CAM as never,
    new Float64Array(16),
  );
  assert.equal(lights.shadowPages, 0);
});
