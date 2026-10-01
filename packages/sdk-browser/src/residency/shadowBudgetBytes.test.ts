import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_GRANT_BYTES, SHADOW_HOST_BYTES, SHADOW_POOL_BYTES } from './shadowBudgetBytes.ts';
import { DEFAULT_CPU_BUDGET, defaultGpuBudget, splitMemoryBudget } from './memoryBudget.ts';

test('the shadow shares read from the lean size modules are the very bytes of before (#1353)', () => {
  // The bytes `develop` gave when the budget read them from the shadow passes' own modules.
  assert.deepEqual(
    [SHADOW_GRANT_BYTES, SHADOW_POOL_BYTES, SHADOW_HOST_BYTES],
    [939_423_092, 944_835_216, 27_370_080],
  );
  const { shadowPool, shadowMirror } = splitMemoryBudget(defaultGpuBudget(), DEFAULT_CPU_BUDGET);
  assert.deepEqual([shadowPool, shadowMirror], [SHADOW_POOL_BYTES, SHADOW_HOST_BYTES]);
});
