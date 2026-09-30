// #349: the budget declares its largest canvas: under a GPU total set, a larger one redraws the
// pools, and a bad one changes nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { worldBudget, worldPools } from './worldBudget.ts';
import { DEFAULT_GEOMETRY_POOL_BUDGET } from '../../residency/pools.ts';
import { DEFAULT_PHYSICS_BUDGET } from '../../../../sdk-core/src/physics/index.ts';
import { defaultGpuBudget } from '../../residency/memoryBudget.ts';

const DEFAULT_GPU_BUDGET = defaultGpuBudget();

const budget = (pools = worldPools()) =>
  worldBudget(pools, { explorer: null }, { last: null }, () => 'webgpu', {
    ...DEFAULT_PHYSICS_BUDGET,
  });
const uhd = { width: 7680, height: 4320 };

test('under a GPU total set, a larger canvas redraws the pools; a bad one changes nothing', () => {
  const pools = worldPools();
  const handle = budget(pools);
  handle.gpu = DEFAULT_GPU_BUDGET;
  handle.canvas = uhd;
  assert.equal(handle.gpu, DEFAULT_GPU_BUDGET);
  assert.ok(pools.geometryPool! < DEFAULT_GEOMETRY_POOL_BUDGET, 'the larger reserve comes first');
  assert.throws(() => (handle.canvas = { width: 0, height: 1 }), /INVALID_BUDGET_CANVAS/);
  assert.deepEqual(handle.canvas, uhd);
});
