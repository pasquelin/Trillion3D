import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGeometryPoolBudget, checkTexturePoolBudget } from './pools.ts';
import { DEFAULT_CPU_BUDGET, DEFAULT_GPU_BUDGET, splitMemoryBudget } from './memoryBudget.ts';

test('every budget entry point preserves its named error for invalid positive safe integers', () => {
  const cases: [string, (value: number) => unknown][] = [
    ['INVALID_GEOMETRY_POOL_BUDGET', checkGeometryPoolBudget],
    ['INVALID_TEXTURE_POOL_BUDGET', checkTexturePoolBudget],
    ['INVALID_GPU_BUDGET', (value) => splitMemoryBudget(value, DEFAULT_CPU_BUDGET)],
    ['INVALID_CPU_BUDGET', (value) => splitMemoryBudget(DEFAULT_GPU_BUDGET, value)],
    [
      'INVALID_BUDGET_CANVAS',
      (value) =>
        splitMemoryBudget(DEFAULT_GPU_BUDGET, DEFAULT_CPU_BUDGET, { width: value, height: 1 }),
    ],
    [
      'INVALID_BUDGET_CANVAS',
      (value) =>
        splitMemoryBudget(DEFAULT_GPU_BUDGET, DEFAULT_CPU_BUDGET, { width: 1, height: value }),
    ],
  ];
  for (const [message, check] of cases)
    for (const value of [-1, -0, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])
      assert.throws(() => check(value), { name: 'Error', message });
  for (const check of [checkGeometryPoolBudget, checkTexturePoolBudget])
    for (const value of [1, Number.MAX_SAFE_INTEGER]) assert.doesNotThrow(() => check(value));
});
