import test from 'node:test';
import assert from 'node:assert/strict';
import { worldBudget } from './worldBudget.ts';
import { DEFAULT_TEXTURE_POOL_BUDGET } from '../../webgpu/residency/memoryBudgets.ts';
import { DEFAULT_GEOMETRY_POOL_BUDGET } from '../../residency/pools.ts';
import {
  DEFAULT_CPU_BUDGET,
  DEFAULT_GPU_BUDGET,
  SHADOW_HOST_BYTES,
  SHADOW_POOL_BYTES,
} from '../../residency/memoryBudget.ts';
import { SHADOW_BUFFER_BYTES, shadowAtlasBytes } from '../../gpu/shadow/atlas.ts';
import { shadowTransmittanceBytes } from '../../gpu/shadow/transmittance.ts';
import {
  SHADOW_TABLE_ENTRIES,
  shadowPoolSide,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { createShadowTable } from '../../../../sdk-core/src/scene/light-shadow/table.ts';
import { createShadowPool } from '../../../../sdk-core/src/scene/light-shadow/pool.ts';
import { DEFAULT_CACHED_BYTES } from '../../streaming/pages.ts';
import { DEFAULT_PHYSICS_BUDGET } from '../../../../sdk-core/src/physics/index.ts';
import type { FrameMetrics } from '../../../../sdk-core/src/index.ts';
import type { WorldRenderer } from '../capability/worldReady.ts';

const budget = (
  renderer: WorldRenderer | null,
  frame: Partial<FrameMetrics> | null,
  pools: { texturePool?: number; geometryPool?: number; gpu?: number; cpu?: number } = {},
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

const MiB = 1024 * 1024;

test("the default totals split into each pool's own default", () => {
  const handle = budget('webgpu', null);
  assert.equal(handle.gpu, DEFAULT_GPU_BUDGET);
  assert.equal(handle.cpu, DEFAULT_CPU_BUDGET);
  assert.deepEqual(handle.split, {
    shadowPool: SHADOW_POOL_BYTES,
    geometryPool: DEFAULT_GEOMETRY_POOL_BUDGET,
    texturePool: DEFAULT_TEXTURE_POOL_BUDGET,
    shadowMirror: SHADOW_HOST_BYTES,
    pageCache: DEFAULT_CACHED_BYTES,
  });
  assert.equal(handle.geometryPool, DEFAULT_GEOMETRY_POOL_BUDGET);
});

test('the shadow share counts the fixed page table, the same on every screen', () => {
  assert.ok(SHADOW_BUFFER_BYTES >= SHADOW_TABLE_ENTRIES * 4);
  const side = shadowPoolSide(Infinity, Infinity);
  // The depth atlas, its static layer, and the transmittance layer of the blended casters.
  const pool = 2 * shadowAtlasBytes(side) + shadowTransmittanceBytes(side);
  assert.equal(SHADOW_POOL_BYTES, pool + SHADOW_BUFFER_BYTES);
  assert.equal(budget('webgpu', null).split.shadowPool, SHADOW_POOL_BYTES);
});

test('the CPU total counts the shadow table host mirror before the page cache', () => {
  // What a real table and pool allocate at the largest pool, whatever the screen: one size.
  const side = shadowPoolSide(Infinity, Infinity);
  const host = createShadowTable(side * side).hostBytes + createShadowPool(side).hostBytes;
  assert.equal(SHADOW_HOST_BYTES, host);
  assert.ok(SHADOW_HOST_BYTES > SHADOW_TABLE_ENTRIES * 5, 'the words and their change flags');
  assert.equal(DEFAULT_CPU_BUDGET, SHADOW_HOST_BYTES + DEFAULT_CACHED_BYTES);
  for (const total of [SHADOW_HOST_BYTES + 1, DEFAULT_CPU_BUDGET, 4096 * MiB]) {
    const handle = budget('webgpu', null, { cpu: total });
    const { shadowMirror, pageCache } = handle.split;
    assert.equal(shadowMirror + pageCache, total, `${total}`);
    assert.equal(shadowMirror, SHADOW_HOST_BYTES);
  }
});

test('a GPU total redraws every pool by the split, and the pools never sum past it', () => {
  for (const total of [SHADOW_POOL_BYTES + 2 * MiB, SHADOW_POOL_BYTES + 300 * MiB, 8192 * MiB]) {
    const pools: { geometryPool?: number; texturePool?: number } = {};
    const handle = budget('webgpu', null, pools);
    handle.gpu = total;
    const { shadowPool, geometryPool, texturePool } = handle.split;
    assert.ok(shadowPool + geometryPool + texturePool <= total, `${total}`);
    assert.deepEqual(pools, { gpu: total, geometryPool, texturePool });
    // A pool set alone stays within what the total leaves it.
    handle.geometryPool = DEFAULT_GEOMETRY_POOL_BUDGET;
    handle.texturePool = DEFAULT_TEXTURE_POOL_BUDGET;
    assert.ok(shadowPool + handle.geometryPool + handle.texturePool! <= total, `${total}`);
  }
});

test('a total the rule cannot take is refused by name and changes nothing', () => {
  const pools: { gpu?: number; cpu?: number } = {};
  const handle = budget('webgpu', null, pools);
  assert.throws(() => (handle.gpu = 0), /INVALID_GPU_BUDGET/);
  // The shadows never shrink: a total under the pool they take is refused, never squeezed.
  assert.throws(() => (handle.gpu = SHADOW_POOL_BYTES - 1), /GPU_BUDGET_UNDER_SHADOW_POOL/);
  assert.equal(handle.split.shadowPool, SHADOW_POOL_BYTES);
  assert.throws(() => (handle.cpu = 1.5), /INVALID_CPU_BUDGET/);
  // The mirror never shrinks either: a CPU total that leaves the page cache nothing is refused.
  assert.throws(() => (handle.cpu = SHADOW_HOST_BYTES), /CPU_BUDGET_UNDER_SHADOW_MIRROR/);
  assert.deepEqual(pools, {});
  handle.cpu = 64 * MiB;
  assert.equal(handle.split.pageCache, 64 * MiB - SHADOW_HOST_BYTES);
});
