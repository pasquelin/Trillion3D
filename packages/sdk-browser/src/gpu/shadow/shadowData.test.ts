// #1345: the page table is sized to the shadow-casting lights in use, as Unreal gives page-table
// entries only to the lights that have a virtual shadow map: a scene of one sun holds one slice's
// span on the GPU, not the 64 slices' 16 MiB. A light whose slice reaches past it grows the table,
// the words held copied over; it never shrinks, a freed slice's pages lingering in the GPU pool.
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
import { createGpuShadowAtlas, SHADOW_TABLE_OFFSET } from './atlas.ts';

const STRIDE = shadowTableStride(SUN_WINDOW);

test('the page table holds one slice span per shadow-casting light in use, not every slice', () => {
  const lights = createWebgpuLightState(16),
    plan = () => lights.plan.plan(lights.store, VIEW, [-10, 0, -10], [10, 5, 10], 0, 0);
  assert.equal(lights.plan.table.heldEntries, STRIDE, 'one span before any light');
  lights.store.add(SUN);
  plan();
  assert.equal(lights.plan.table.heldEntries, STRIDE, 'a sun: one span');
  assert.equal(STRIDE * 4, 256 * 1024, "one span's bytes: 256 KiB");
  assert.equal(SHADOW_TABLE_ENTRIES, MAX_SHADOW_SLICES * STRIDE, 'the 64 slices: 16 MiB');
  lights.store.add(LAMP);
  lights.store.add({ ...LAMP, id: 'lamp 2', position: [4, 3, 0] });
  plan();
  assert.equal(lights.plan.table.heldEntries, 3 * STRIDE, 'three lights: three spans');
  lights.store.remove('lamp 2');
  plan();
  assert.equal(lights.plan.table.heldEntries, 3 * STRIDE, 'never shrunk');
});

test("the GPU table is the lights' spans long, grown with its words kept", async () => {
  const { device, copies, destroyed } = fakeDevice();
  const atlas = await createGpuShadowAtlas(device, {} as GPUBindGroupLayout, STRIDE),
    first = atlas.dataBuffer,
    bytes = atlas.allocationBytes;
  assert.equal(first.size, SHADOW_TABLE_OFFSET + STRIDE * 4);
  atlas.holdTable(STRIDE);
  assert.equal(atlas.dataBuffer, first, 'held already: the same buffer');
  atlas.holdTable(3 * STRIDE);
  assert.equal(atlas.dataBuffer.size, SHADOW_TABLE_OFFSET + 3 * STRIDE * 4);
  assert.deepEqual(copies, [
    { from: first, fromOffset: 0, to: atlas.dataBuffer, toOffset: 0, size: first.size },
  ]);
  assert.ok(destroyed.includes(first), 'the old buffer freed');
  assert.equal(atlas.allocationBytes - bytes, 2 * STRIDE * 4, 'its bytes counted');
});
