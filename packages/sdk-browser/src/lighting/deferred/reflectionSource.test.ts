// #685: the unfogged image the screen reflections read is a render pass of its own, before the
// lighting. A GPU timing names a pass by its label: without one it read `beginRenderPass`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeferredLighting, DEFERRED_LIGHTING_PASS } from './deferred.ts';
import { REFLECTION_SOURCE_PASS } from '../../reflections/encode.ts';
import type { ScreenReflection } from '../../reflections/gpu.ts';
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

test('a reflecting image draws its reflection source, then the lighting, each under its label', async () => {
  const { device } = fakeDevice();
  const lighting = await createDeferredLighting(device);
  const labels: Array<string | undefined> = [];
  const encoder = {
    beginRenderPass: (descriptor: GPURenderPassDescriptor) => {
      labels.push(descriptor.label);
      return { setPipeline() {}, setBindGroup() {}, setViewport() {}, draw() {}, end() {} };
    },
  } as unknown as GPUCommandEncoder;
  const views = [0, 1, 2, 3].map(() => ({}) as GPUTextureView),
    surface = { views: () => views } as unknown as SurfaceBuffer,
    view = {} as GPUTextureView,
    reflection = { active: true, view, group: {} } as unknown as ScreenReflection;
  const lit = () => lighting.bind(surface, view, view, true, { lights: {} as GPUBuffer });
  lit();
  await lighting.settle();
  lit();
  assert.equal(lighting.usesContract, true, 'the direct program reflects');
  lighting.light(encoder, view, reflection);
  assert.deepEqual(labels, [REFLECTION_SOURCE_PASS, DEFERRED_LIGHTING_PASS]);
  lighting.dispose();
});

// #1157: the frame counts what `light` returns; it must be the passes it began, never a guess.
test('the lighting counts exactly the passes it draws, mirror or not, contract or not', async () => {
  const { device } = fakeDevice();
  const lighting = await createDeferredLighting(device);
  let begun = 0;
  const encoder = {
    beginRenderPass: () => {
      begun++;
      return { setPipeline() {}, setBindGroup() {}, setViewport() {}, draw() {}, end() {} };
    },
  } as unknown as GPUCommandEncoder;
  const views = [0, 1, 2, 3].map(() => ({}) as GPUTextureView),
    surface = { views: () => views } as unknown as SurfaceBuffer,
    view = {} as GPUTextureView;
  const mirror = (active: boolean) => ({ active, view, group: {} }) as unknown as ScreenReflection;
  const bind = (contract: boolean) =>
    lighting.bind(surface, view, view, contract, { lights: {} as GPUBuffer });
  bind(true);
  await lighting.settle();
  for (const contract of [false, true]) {
    bind(contract);
    assert.equal(lighting.usesContract, contract);
    for (const reflection of [undefined, mirror(false), mirror(true)]) {
      begun = 0;
      const counted = lighting.light(encoder, view, reflection);
      const case_ = `contract ${contract}, mirror ${reflection?.active ?? 'none'}`;
      assert.equal(counted, begun, case_);
      assert.equal(begun, contract && reflection?.active ? 2 : 1, case_);
    }
  }
  lighting.dispose();
});
