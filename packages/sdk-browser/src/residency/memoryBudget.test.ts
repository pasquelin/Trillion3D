// The effect chain's targets in the GPU total (#349, #483 rule 5): reserved at their largest by
// the rule the renderers count them with, before the pools, whose defaults stay what they were.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { effect } from '../../../sdk-core/src/world/effect/index.ts';
import { PORTABLE_TEXTURE_SIDE } from '../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { createWebglEffects } from '../effects/webglEffects.ts';
import { createWebgpuEffects } from '../effects/webgpuEffects.ts';
import { createTestContext } from '../webgl/core/testContext.fixture.ts';
import { DEFAULT_GEOMETRY_POOL_BUDGET } from './pools.ts';
import { DEFAULT_TEXTURE_POOL_BUDGET } from '../webgpu/residency/memoryBudgets.ts';
import {
  BOUNCE_PROBE_BYTES,
  DEFAULT_CPU_BUDGET,
  DEFAULT_GPU_BUDGET,
  EFFECT_TARGET_BYTES,
  SHADOW_POOL_BYTES,
  splitMemoryBudget,
} from './memoryBudget.ts';

const side = PORTABLE_TEXTURE_SIDE;
const chain = [effect.bloom(), effect.bloom({ intensity: 0.5 })];

test('the reserve is what the WebGL2 chain holds on the largest image, the most either holds', async () => {
  const webgl = createWebglEffects(createTestContext().gl);
  webgl.begin(chain, side, side);
  assert.equal(webgl.bytes, EFFECT_TARGET_BYTES, 'scene target, two pass targets, bloom levels');
  const gpu = fakeDevice();
  const webgpu = createWebgpuEffects(gpu.device, { ready() {}, failed: assert.fail });
  const input = {} as GPUTextureView,
    encoder = {
      beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }),
    } as unknown as GPUCommandEncoder;
  webgpu.encode(encoder, chain, input, side, side);
  while (webgpu.loading) await new Promise((resolve) => setImmediate(resolve));
  webgpu.encode(encoder, chain, input, side, side);
  assert.ok(webgpu.bytes > 0 && webgpu.bytes < EFFECT_TARGET_BYTES, `${webgpu.bytes}`);
});

test('the split reserves the effect targets before the pools, whose defaults stay', () => {
  const shares = splitMemoryBudget(DEFAULT_GPU_BUDGET, DEFAULT_CPU_BUDGET);
  assert.equal(shares.effectTargets, EFFECT_TARGET_BYTES);
  assert.equal(shares.geometryPool, DEFAULT_GEOMETRY_POOL_BUDGET);
  assert.equal(shares.texturePool, DEFAULT_TEXTURE_POOL_BUDGET);
  const fixed = SHADOW_POOL_BYTES + BOUNCE_PROBE_BYTES + EFFECT_TARGET_BYTES;
  assert.equal(
    DEFAULT_GPU_BUDGET,
    fixed + DEFAULT_GEOMETRY_POOL_BUDGET + DEFAULT_TEXTURE_POOL_BUDGET,
  );
  assert.throws(() => splitMemoryBudget(fixed - 1, DEFAULT_CPU_BUDGET), /UNDER_SHADOW_POOL/);
  const least = splitMemoryBudget(fixed + 2, DEFAULT_CPU_BUDGET);
  assert.ok(fixed + least.geometryPool + least.texturePool <= fixed + 2);
});
