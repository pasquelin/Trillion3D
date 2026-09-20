import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GEOMETRY_POOL_BUDGET,
  DEFAULT_TEXTURE_UPLOAD_MS,
  geometryPoolFor,
  textureUploadMsFor,
} from './webgpuMemoryBudgets.ts';

const MIB = 1024 * 1024;

test('the geometry pool is a fixed byte reservoir, 512 MiB by default like the reference', () => {
  assert.equal(DEFAULT_GEOMETRY_POOL_BUDGET, 512 * MIB);
  const pool = geometryPoolFor({
    budgetBytes: DEFAULT_GEOMETRY_POOL_BUDGET,
    pageBytes: 1500,
    uniquePages: 1_000_000,
    rootPages: 300,
  });
  assert.equal(pool.slots, Math.floor((512 * MIB) / 1500));
  assert.equal(pool.allocatedBytes, pool.slots * 1500);
  assert.equal(pool.clamp, null);
});

test('the pool shrinks to the scene or the page cap, and rises to root coverage', () => {
  const small = geometryPoolFor({
    budgetBytes: 512 * MIB,
    pageBytes: 1500,
    uniquePages: 10,
    rootPages: 2,
  });
  assert.deepEqual([small.slots, small.clamp], [10, 'scene']);
  const capped = geometryPoolFor({
    budgetBytes: 512 * MIB,
    pageBytes: 1500,
    uniquePages: 10_000,
    rootPages: 2,
    maxResidentPages: 64,
  });
  assert.deepEqual([capped.slots, capped.clamp], [64, 'page-cap']);
  // Session ceiling, what the drawable-page tables have sized.
  const ceiled = geometryPoolFor({
    budgetBytes: 512 * MIB,
    pageBytes: 1500,
    uniquePages: 10_000,
    rootPages: 2,
    ceilingSlots: 300,
  });
  assert.deepEqual([ceiled.slots, ceiled.clamp], [300, 'ceiling']);
  // An 8 MiB budget on 1,500-byte pages makes 5,592 slots: under 6,000 roots it is
  // raised to them — roots are always resident, as they are outside the pool in the reference.
  const roots = geometryPoolFor({
    budgetBytes: 8 * MIB,
    pageBytes: 1500,
    uniquePages: 10_000,
    rootPages: 6000,
  });
  assert.deepEqual([roots.slots, roots.clamp], [6000, 'root-cover']);
  assert.throws(
    () => geometryPoolFor({ budgetBytes: 0, pageBytes: 1500, uniquePages: 10, rootPages: 1 }),
    /INVALID_GEOMETRY_POOL_BUDGET/,
  );
});

test('only the device limit bounds the pool, and it refuses only when even the roots do not fit', () => {
  const limits = { maxBufferSize: 1 * MIB, maxStorageBufferBindingSize: 4 * MIB };
  const pool = geometryPoolFor({
    budgetBytes: 512 * MIB,
    pageBytes: 1024,
    uniquePages: 10_000,
    rootPages: 10,
    limits,
  });
  assert.deepEqual([pool.slots, pool.clamp], [1024, 'device-limit']);
  assert.throws(
    () =>
      geometryPoolFor({
        budgetBytes: 512 * MIB,
        pageBytes: 1024,
        uniquePages: 10_000,
        rootPages: 2000,
        limits,
      }),
    /GEOMETRY_POOL_DEVICE_LIMIT/,
  );
});

test('the tile pass budget is what the host declared, 1 ms by default, never under zero', () => {
  assert.equal(textureUploadMsFor(undefined), DEFAULT_TEXTURE_UPLOAD_MS);
  assert.equal(textureUploadMsFor(Number.NaN), DEFAULT_TEXTURE_UPLOAD_MS);
  assert.equal(textureUploadMsFor(0.25), 0.25);
  assert.equal(textureUploadMsFor(-3), 0, 'a negative budget still lands one tile per pass');
});
