// The shadow work of a frame the CPU cut draws — a capture, a restored view, a session after the
// GPU selection fell back: the direct-lighting pass draws every region the plan wrote, the light
// cut's state outlives the frame, and a cluster the pool takes in restales the pages it covers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import { DRAW_FULL } from '../../../../sdk-core/src/scene/light-shadow/pool.ts';
import { createWebgpuLightState } from '../pages/state/lights.ts';
import { planImageShadows } from '../pages/render/encodeShadows.ts';
import { encodeShadowCasters, redrawShortPages } from './casters.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

const SUN = {
  id: 'sun',
  kind: 'directional' as const,
  direction: [0, -1, 0] as [number, number, number],
  color: [1, 1, 1] as [number, number, number],
  intensity: 1,
  castsShadow: true,
};

test('a plan read a second time in a frame returns its regions, not its pages', () => {
  const lights = createWebgpuLightState(32);
  lights.store.add(SUN);
  const volumes = new Float32Array(4 * SHADOW_CULL_FLOATS);
  // Two pages drawn in full over a static layer: four regions.
  lights.regions.push(3, DRAW_FULL, volumes, new Uint32Array(volumes.buffer));
  lights.regions.push(4, DRAW_FULL, volumes, new Uint32Array(volumes.buffer));
  lights.shadowPages = 2;
  lights.plannedFrame = 7;
  const rt = { lights, run: { frame: 7 } } as unknown as WebgpuPagesRuntime;
  assert.equal(planImageShadows(rt, undefined as never), 4);
});

test('a frame on the CPU cut keeps the light cut, and a dropped cut lifts its view limit', () => {
  const lights = createWebgpuLightState(32);
  const cut = { unsettled: true };
  lights.lightCut = cut as never;
  Object.assign(lights, {
    cull: { begin() {}, encode() {} },
    spheres: { buffer: {} },
    mobilityRows: {},
  });
  const rt = {
    lights,
    vis: { gpuDraw: {} },
    run: { gpuFrameActive: false, gpuSelection: {}, frame: 3 },
    layout: { rows: { packedCount: 0 } },
    setup: { maxCorners: 0 },
    timing: {},
  } as unknown as WebgpuPagesRuntime;
  encodeShadowCasters(rt, {} as GPUCommandEncoder, 0);
  assert.equal(lights.lightCut, cut, 'its waiting pages and its reports stay');
  lights.plan.admission.setViewLimit(3);
  lights.lightCut = undefined;
  redrawShortPages(rt, 4, 64, false);
  assert.equal(lights.plan.admission.viewLimit, 24, 'no cut left to limit the frame');
});
