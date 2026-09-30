import test from 'node:test';
import assert from 'node:assert/strict';
import { worldBudget, worldPools, type Pools } from './worldBudget.ts';
import { DEFAULT_TEXTURE_POOL_BUDGET } from '../../residency/pools.ts';
import { SHADOW_ATLAS_BYTES } from '../../residency/memoryBudget.ts';
import { SHADOW_BUFFER_BYTES } from '../../gpu/shadow/atlas.ts';
import { SHADOW_BATCH_GPU_BYTES } from '../../gpu/shadow/batchBudget.ts';
import { shadowTransmittanceBytes } from '../../gpu/shadow/transmittance.ts';
import {
  SHADOW_TABLE_ENTRIES,
  shadowPoolSize,
  shadowPoolShape,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { DEFAULT_PHYSICS_BUDGET } from '../../../../sdk-core/src/physics/index.ts';
import { type FrameMetrics } from '../../../../sdk-core/src/index.ts';
import type { WorldRenderer } from '../capability/worldReady.ts';
import { SHADOW_GRANT_BYTES } from '../../residency/memoryBudget.ts';

const SHADOW_POOL_BYTES = SHADOW_GRANT_BYTES + SHADOW_BATCH_GPU_BYTES;

const budget = (
  renderer: WorldRenderer | null,
  frame: Partial<FrameMetrics> | null,
  asked: Omit<Pools, 'pageCache'> = {},
  pools: Pools = Object.assign(worldPools(), asked),
) =>
  worldBudget(pools, { explorer: null }, { last: frame as FrameMetrics | null }, () => renderer, {
    ...DEFAULT_PHYSICS_BUDGET,
  });

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

test('raycastTrees reads and sets the raycast tree cache budget', () => {
  const handle = budget(null, null);
  const before = handle.raycastTrees;
  handle.raycastTrees = 1024;
  assert.equal(handle.raycastTrees, 1024);
  handle.raycastTrees = before;
});

test('the shadow share counts the pool at 3840 × 2160 under one sun, and the page table', () => {
  assert.ok(SHADOW_BUFFER_BYTES >= SHADOW_TABLE_ENTRIES * 4);
  assert.deepEqual(shadowPoolShape(shadowPoolSize(3840, 2160)), { side: 53, layers: 2 });
  const pool = 2 * SHADOW_ATLAS_BYTES + shadowTransmittanceBytes(53, 2);
  assert.ok(SHADOW_POOL_BYTES > pool + SHADOW_BUFFER_BYTES + SHADOW_BATCH_GPU_BYTES, 'requests');
  assert.equal(budget('webgpu', null).split.shadowPool, SHADOW_POOL_BYTES);
});

// #487's audit: the shadow pool a screen takes, with its static layer and fixed buffers, is sized
// inside `split.shadowPool`, and a total below 512 MiB never lets the pools sum past it.
