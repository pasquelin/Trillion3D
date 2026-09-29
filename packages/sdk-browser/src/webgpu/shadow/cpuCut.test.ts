// The shadow work of a frame the CPU cut draws — a capture, a restored view, a session after the
// GPU selection fell back: the direct-lighting pass draws every region the plan wrote, the light
// cut's state outlives the frame, and a cluster the pool takes in restales the pages it covers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VIEW } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { createWebgpuLightState } from '../pages/state/lights.ts';
import { planImageShadows } from '../pages/render/encodeShadows.ts';
import { encodeShadowCasters } from './casters.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import { DRAW_ALL } from '../../../../sdk-core/src/scene/light-shadow/pool.ts';
import { MAX_SHADOW_REGIONS } from '../../gpu/shadow/atlas.ts';
import { SHADOW_REGION_INDIRECT_BYTES } from '../../gpu/shadow/batchBudget.ts';
import { drawRegionCasters } from '../pages/render/encodeRegionDraws.ts';
import { planPagePasses } from './pagePasses.ts';

const SUN = {
  id: 'sun',
  kind: 'directional' as const,
  direction: [0, -1, 0] as [number, number, number],
  color: [1, 1, 1] as [number, number, number],
  intensity: 1,
  castsShadow: true,
};

test('a plan read a second time in a frame returns its pages, and plans nothing more', () => {
  const lights = createWebgpuLightState(32);
  lights.store.add(SUN);
  const planned = lights.plan.plan(lights.store, VIEW, [-10, 0, -10], [10, 5, 10], 7, 0);
  assert.ok(planned > 0, 'the floor pages of a new sun');
  lights.plannedFrame = 7;
  const rt = { lights, run: { frame: 7 } } as unknown as WebgpuPagesRuntime;
  assert.equal(planImageShadows(rt, undefined as never), planned);
});

test('a frame on the CPU cut keeps the light cut', () => {
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
    timing: {},
  } as unknown as WebgpuPagesRuntime;
  encodeShadowCasters(rt, {} as GPUCommandEncoder, 0, 0, 0, 0);
  assert.equal(lights.lightCut, cut, 'its waiting pages and its reports stay');
});

// #1210: on the CPU cut, the regions of a light view whose caster list is empty keep zero instances
// in every command; they encode no bind group and no draw, and the other regions encode as before.
test('a light view with an empty caster list on the CPU cut encodes no draw for its regions', () => {
  const lights = createWebgpuLightState(32),
    volumes = new Float32Array(MAX_SHADOW_REGIONS * SHADOW_CULL_FLOATS);
  // View 0 draws pages 0 and 1, view 1 page 2: three regions.
  for (const page of [0, 1, 2])
    lights.regions.push(page, DRAW_ALL, volumes, new Uint32Array(volumes.buffer));
  const culled: number[][] = [],
    key = [{}, {}, {}, {}, {}, {}, undefined];
  Object.assign(lights, {
    runs: {
      count: 2,
      list: [
        { first: 0, count: 2 },
        { first: 2, count: 1 },
      ],
    },
    cpuCasters: { frame: 3, source: {}, indirect: {}, bases: [0, 0], lengths: [0, 5] },
    cull: { begin() {}, encode: (...a: number[]) => culled.push(a.slice(3)), kept: key[5] },
    spheres: { buffer: {} },
    mobilityRows: {},
    shadowGroupsKey: key,
    shadowGroups: Array.from({ length: 2 * MAX_SHADOW_REGIONS }, (_, i) => `g${i}`),
    shadows: { faceGroup: 'faces', faceStride: 256, hasEnvelope: () => false },
    mobility: { hasCutouts: false },
  });
  const rt = {
    lights,
    vis: { gpuDraw: {}, visBindGroupLayout: {}, concatPos: key[1], concatUv: key[2] },
    gpu: { cache: { buffer: key[0] } },
    run: { gpuFrameActive: false, frame: 3 },
    layout: { rows: { packedCount: 5 } },
    setup: { maxCorners: 0 },
    timing: {},
  } as unknown as WebgpuPagesRuntime;
  Object.assign(rt.vis, { pageTable: key[3], textures: { color: { views: key[4] } } });
  Object.assign(rt.vis, { mapsSampler: {}, zeroFlags: {} });
  assert.ok(encodeShadowCasters(rt, {} as GPUCommandEncoder, 3, 0, 3, 0));
  assert.deepEqual(
    culled,
    [
      [0, 2, 0],
      [2, 1, 5],
    ],
    'the cull itself as before',
  );
  assert.deepEqual([0, 1, 2].map(lights.regions.casterless), [true, true, false]);
  planPagePasses(lights.regions, 3);
  const calls: string[] = [];
  const pass = new Proxy({} as GPURenderPassEncoder, {
    get:
      (_, name: string) =>
      (...args: unknown[]) =>
        void calls.push(`${name} ${args[1]}`),
  });
  assert.equal(drawRegionCasters(rt, {} as GPUDevice, pass, 0, false, 1, ['depth' as never]), 1);
  assert.deepEqual(
    calls.filter((c) => c.startsWith('setBindGroup') || c.startsWith('draw')),
    ['setBindGroup g2', 'setBindGroup faces', `drawIndirect ${2 * SHADOW_REGION_INDIRECT_BYTES}`],
  );
  // The same regions encoded again once their list holds casters draw again.
  lights.cpuCasters!.lengths[0] = 3;
  assert.ok(encodeShadowCasters(rt, {} as GPUCommandEncoder, 3, 0, 3, 0));
  assert.deepEqual([0, 1, 2].map(lights.regions.casterless), [false, false, false]);
  // The next batch's regions start drawable again.
  lights.regions.reset();
  lights.regions.push(0, DRAW_ALL, volumes, new Uint32Array(volumes.buffer));
  assert.equal(lights.regions.casterless(0), false);
});
