// The cache on the GPU-cut path gives its slots back in the order the cut published (#872).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { createGpuPageCache } from './pages.ts';

const orderOf = (keys: string[]) => ({ count: keys.length, keyAt: (at: number) => keys[at] });
async function cacheOf(keys: string[]) {
  const { device } = fakeDevice({ limits: { maxBufferSize: 1024 } });
  const bytes = { read: async () => new Uint8Array([1, 2, 3, 4]) };
  const cache = createGpuPageCache(device, bytes, { pageBytes: 4, slots: keys.length });
  for (const key of keys) await cache.load(key);
  return cache;
}

test('a published order evicts in its order, and never a page it leaves out', async () => {
  const cache = await cacheOf(['read', 'old', 'older']);
  // `read` was read by the cut this frame: the queue leaves it out, though nothing pins it.
  cache.evictInOrder(orderOf(['older', 'old']));
  await cache.load('a');
  assert.ok(!cache.get('older') && cache.get('old') && cache.get('read'));
  await cache.load('b');
  assert.ok(!cache.get('old') && cache.get('read'));
  // The order is spent: the burst stops, the page left out stays.
  await assert.rejects(cache.load('c'), /ALL_PAGES_PINNED/);
  // Without a GPU cut, the least recent page goes first again.
  cache.evictInOrder(undefined);
  await cache.load('c');
  assert.ok(!cache.get('read'));
});

test('a page a lower tier reads goes after every other page of the order', async () => {
  const cache = await cacheOf(['caster', 'old']);
  // Only a light cut reads `caster`: the camera never stamped it, so it heads the order.
  cache.evictInOrder(orderOf(['caster', 'old']));
  cache.touch('caster');
  await cache.load('a');
  assert.ok(cache.get('caster') && !cache.get('old'));
  // Never pinned: a camera page still takes its slot once nothing else is left.
  await cache.load('b');
  assert.ok(!cache.get('caster'));
});
