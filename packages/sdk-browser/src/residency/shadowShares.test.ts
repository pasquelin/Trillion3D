import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_GPU_SHARE, SHADOW_HOST_SHARE } from './shadowShares.ts';
import { SHADOW_HOST_BYTES, SHADOW_POOL_BYTES } from './shadowBudgetBytes.ts';
import { splitMemoryBudget, DEFAULT_CPU_BUDGET, defaultGpuBudget } from './memoryBudget.ts';

test("the core's shadow shares are the bytes the WebGPU renderer's formulas give", () => {
  assert.equal(SHADOW_GPU_SHARE, SHADOW_POOL_BYTES);
  assert.equal(SHADOW_HOST_SHARE, SHADOW_HOST_BYTES);
  const { shadowPool, shadowMirror } = splitMemoryBudget(defaultGpuBudget(), DEFAULT_CPU_BUDGET);
  assert.deepEqual([shadowPool, shadowMirror], [SHADOW_POOL_BYTES, SHADOW_HOST_BYTES]);
});
