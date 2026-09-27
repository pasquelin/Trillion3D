import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TEXTURE_TRANSFER_BYTES,
  DEFAULT_TEXTURE_UPLOAD_MS,
  poolTaking,
  textureTransferBytesFor,
  textureUploadMsFor,
} from './memoryBudgets.ts';

test('the tile pass budgets are what the host declared, 16 MiB and 1 ms by default, one tile at least', () => {
  assert.equal(textureUploadMsFor(undefined), DEFAULT_TEXTURE_UPLOAD_MS);
  assert.equal(textureUploadMsFor(Number.NaN), DEFAULT_TEXTURE_UPLOAD_MS);
  assert.equal(textureUploadMsFor(0.25), 0.25);
  assert.equal(textureUploadMsFor(-3), 0, 'a negative budget still lands one tile per pass');
  assert.equal(textureTransferBytesFor(undefined), DEFAULT_TEXTURE_TRANSFER_BYTES);
  assert.equal(textureTransferBytesFor(Number.POSITIVE_INFINITY), DEFAULT_TEXTURE_TRANSFER_BYTES);
  assert.equal(textureTransferBytesFor(4096), 4096);
  assert.equal(textureTransferBytesFor(0), 1, 'a zero byte budget still lands one tile per pass');
});

// #847: a texture taken after open grows its lane only when its tail finds no free place — never
// by evicting a held tile —, under the budget and the device's layers, else refused by name.
test('a lane takes a texture after open in a free place, else one layer more, else refused by name', () => {
  const lanes = { lossless: 1, rgba: 0, 'two-channel': 0 };
  const pool = {
    budgetBytes: 100,
    layers: { color: lanes, data: lanes },
    allocatedBytes: 20,
    clamp: null,
  };
  const limits = { budgetBytes: 100, heldBytes: 0, maxLayers: 4 };
  const taking = (resident: number, lane: 'lossless' | 'rgba' = 'lossless') =>
    ({ kind: 'color', lane, resident, tails: 2, streams: true }) as const;
  assert.equal(poolTaking(pool, taking(899), 10, limits), pool, 'a free place: nothing grows');
  const grown = poolTaking(pool, taking(900), 10, limits);
  assert.deepEqual(grown.layers.color, { ...lanes, lossless: 2 }, 'a full lane: one layer');
  assert.deepEqual([grown.layers.data, grown.allocatedBytes], [lanes, 30]);
  const opened = poolTaking(pool, taking(0, 'rgba'), 10, limits);
  assert.deepEqual(opened.layers.color, { ...lanes, rgba: 1 }, 'a lane with no pool opens one');
  const refused = (over: Partial<typeof limits>) => () =>
    poolTaking(pool, taking(900), 10, { ...limits, ...over });
  assert.throws(refused({ budgetBytes: 29 }), { code: 'TEXTURE_BUDGET' });
  assert.throws(refused({ heldBytes: 71 }), { code: 'TEXTURE_BUDGET' }, 'live textures count');
  assert.throws(refused({ maxLayers: 1 }), { code: 'TEXTURE_BUDGET' }, "the device's layers");
  assert.equal(poolTaking(pool, taking(899), 10, { ...limits, budgetBytes: 1 }), pool);
});
