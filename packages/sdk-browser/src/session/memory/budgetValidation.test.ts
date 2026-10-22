import { DEFAULT_CACHED_BYTES } from '../../geometry/streaming/pageCache.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkTexturePoolBudget, geometryPoolFor } from './pools.ts'
import { splitMemoryBudget } from './memoryBudget.ts'
import { DEFAULT_GPU_BUDGET } from './budget.fixture.ts'

/** The geometry pool made over a budget of `bytes`: refused by name before any slot is drawn. */
const checkGeometryPoolBudget = (bytes: number) =>
  geometryPoolFor({ budgetBytes: bytes, pageBytes: 8, uniquePages: 100, rootPages: 1 })

test('every budget entry point preserves its named error for invalid positive safe integers', () => {
  const cases: [string, (value: number) => unknown][] = [
    ['INVALID_GEOMETRY_POOL_BUDGET', checkGeometryPoolBudget],
    ['INVALID_TEXTURE_POOL_BUDGET', checkTexturePoolBudget],
    ['INVALID_GPU_BUDGET', (value) => splitMemoryBudget(value, DEFAULT_CACHED_BYTES)],
    ['INVALID_CPU_BUDGET', (value) => splitMemoryBudget(DEFAULT_GPU_BUDGET, value)],
    [
      'INVALID_BUDGET_CANVAS',
      (value) =>
        splitMemoryBudget(DEFAULT_GPU_BUDGET, DEFAULT_CACHED_BYTES, { width: value, height: 1 }),
    ],
    [
      'INVALID_BUDGET_CANVAS',
      (value) =>
        splitMemoryBudget(DEFAULT_GPU_BUDGET, DEFAULT_CACHED_BYTES, { width: 1, height: value }),
    ],
  ]
  for (const [message, check] of cases)
    for (const value of [-1, -0, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])
      assert.throws(() => check(value), { name: 'Error', message })
  for (const check of [checkGeometryPoolBudget, checkTexturePoolBudget])
    for (const value of [1, Number.MAX_SAFE_INTEGER]) assert.doesNotThrow(() => check(value))
})
