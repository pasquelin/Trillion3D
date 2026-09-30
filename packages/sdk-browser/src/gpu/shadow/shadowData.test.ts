// #1345: the page table is sized to the shadow-casting lights in use, as Unreal gives page-table
// entries only to the lights that have a virtual shadow map: a scene of one sun holds one slice's
// span, host and GPU alike, not the 64 slices' 16 MiB. A light whose slice reaches past it grows the
// table by doubling, the GPU's by the tables' own path under the device's out-of-memory check, the
// words held copied over, the light waiting unshadowed until then; it never shrinks, a freed
// slice's pages lingering in the GPU pool.
import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_SHADOW_SLICES } from '../../../../sdk-core/src/index.ts';
import {
  LAMP,
  SUN,
  VIEW,
} from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import {
  SHADOW_TABLE_ENTRIES,
  SUN_WINDOW,
  shadowTableStride,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { createWebgpuLightState } from '../../webgpu/pages/state/lights.ts';
import { followShadowTable, growShadowTable } from '../../webgpu/shadow/shadowTableGrowth.ts';
import type { WebgpuPagesRuntime } from '../../webgpu/pages/runtime.ts';
import { createGpuShadowAtlas } from './atlas.ts';
import { SHADOW_TABLE_OFFSET } from './shadowData.fixture.ts';

const STRIDE = shadowTableStride(SUN_WINDOW);
const plan = (lights: ReturnType<typeof createWebgpuLightState>) =>
  lights.plan.plan(lights.store, VIEW, [-10, 0, -10], [10, 5, 10], 0, 0);

test('the host table holds one slice span per shadow-casting light in use, not every slice', () => {
  const lights = createWebgpuLightState(16),
    { table } = lights.plan;
  assert.equal(table.heldEntries, STRIDE, 'one span before any light');
  lights.store.add(SUN);
  plan(lights);
  assert.equal(table.heldEntries, STRIDE, 'a sun: one span');
  assert.equal(STRIDE * 4, 256 * 1024, "one span's bytes: 256 KiB");
  assert.equal(SHADOW_TABLE_ENTRIES, MAX_SHADOW_SLICES * STRIDE, 'the 64 slices: 16 MiB');
  lights.store.add(LAMP);
  plan(lights);
  lights.store.add({ ...LAMP, id: 'lamp 2', position: [4, 3, 0] });
  plan(lights);
  assert.equal(table.heldEntries, 4 * STRIDE, 'three lights: grown by doubling, four spans');
  assert.equal(table.words.length, table.heldEntries, 'the words are the spans held');
  lights.store.remove('lamp 2');
  plan(lights);
  assert.equal(table.heldEntries, 4 * STRIDE, 'never shrunk');
});

test("a light past the GPU's table waits unshadowed until the device grants it grown", async () => {
  const { device, copies, destroyed } = fakeDevice(),
    lights = createWebgpuLightState(16),
    atlas = await createGpuShadowAtlas(device, {} as GPUBindGroupLayout, STRIDE),
    first = atlas.dataBuffer,
    bytes = atlas.allocationBytes;
  lights.shadows = atlas;
  followShadowTable(lights, atlas.tableEntries);
  lights.store.add(SUN);
  lights.store.add(LAMP);
  plan(lights);
  assert.equal(lights.plan.counts.unslicedCasters, 1, 'the lamp waits, counted');
  assert.equal(lights.plan.table.wantedEntries, 3 * STRIDE, 'its span and one ahead');
  const rt = {
    lights,
    gpu: { device },
    run: { lost: false, gate: { resourcesChanged() {} } },
    signal: new AbortController().signal,
    setup: {},
    layout: {},
  } as unknown as WebgpuPagesRuntime;
  growShadowTable(rt);
  assert.equal(atlas.dataBuffer, first, 'the frame binds the table it holds');
  await rt.layout.growing;
  assert.equal(atlas.dataBuffer.size, SHADOW_TABLE_OFFSET + 3 * STRIDE * 4);
  assert.deepEqual(copies, [
    { from: first, fromOffset: 0, to: atlas.dataBuffer, toOffset: 0, size: first.size },
  ]);
  assert.ok(destroyed.includes(first), 'the old buffer freed');
  assert.equal(atlas.allocationBytes - bytes, 2 * STRIDE * 4, 'its bytes counted');
  assert.equal(lights.plan.table.heldEntries, 3 * STRIDE, 'the host words grown alike');
  plan(lights);
  assert.equal(lights.plan.counts.unslicedCasters, 0, 'the lamp takes its slice');
  assert.equal(atlas.growTable(3 * STRIDE), undefined, 'held: nothing to grow');
});
