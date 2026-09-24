import test from 'node:test';
import assert from 'node:assert/strict';
import { worldBudget } from './worldHandles.ts';
import { DEFAULT_TEXTURE_POOL_BUDGET } from '../../webgpu/residency/memoryBudgets.ts';
import type { FrameMetrics } from '../../../../sdk-core/src/index.ts';
import type { WorldRenderer } from '../capability/worldReady.ts';

const budget = (
  renderer: WorldRenderer | null,
  frame: Partial<FrameMetrics> | null,
  pools: { texturePool?: number } = {},
) => worldBudget(pools, { explorer: null }, { last: frame as FrameMetrics | null }, () => renderer);

test('texturePool is null on WebGL2, which holds no texture pool', () => {
  assert.equal(budget('webgl2', { texturePoolBytes: null }).texturePool, null);
  assert.equal(budget('webgl2', null, { texturePool: 1024 }).texturePool, null);
});

test('texturePool on WebGPU falls back to the asked budget while no pool was published', () => {
  assert.equal(
    budget('webgpu', { texturePoolBytes: null }, { texturePool: 4096 }).texturePool,
    4096,
  );
  assert.equal(
    budget('webgpu', { texturePoolBytes: null }).texturePool,
    DEFAULT_TEXTURE_POOL_BUDGET,
  );
  assert.equal(budget(null, null).texturePool, DEFAULT_TEXTURE_POOL_BUDGET);
});

test('texturePool on WebGPU reads what the last frame held', () => {
  assert.equal(
    budget('webgpu', { texturePoolBytes: 2048 }, { texturePool: 4096 }).texturePool,
    2048,
  );
});
