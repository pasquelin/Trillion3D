// The sparse map the cut's per-page state lives in (#486): it answers as a dense table would, and
// holds storage for its entries only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSparseInts, grown } from './sparseInts.ts';

test('random writes, adds and removals read back as a plain map', () => {
  const map = createSparseInts(),
    model = new Map<number, number>();
  let seed = 7;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let step = 0; step < 20000; step++) {
    // Keys clustered and spread, so probes collide and removals shift runs back.
    const key = next() < 0.5 ? Math.floor(next() * 64) : Math.floor(next() * 1e6);
    const roll = next();
    if (roll < 0.4) {
      model.set(key, (model.get(key) ?? 0) + 1);
      map.add(key, 1);
    } else if (roll < 0.8) {
      model.delete(key);
      map.set(key, 0);
    } else assert.equal(map.get(key), model.get(key) ?? 0);
  }
  assert.equal(map.size, model.size);
  for (const [key, value] of model) assert.equal(map.get(key), value);
  const seen = new Map<number, number>();
  map.forEach((key, value) => seen.set(key, value));
  assert.deepEqual(seen, model);
});

test('storage follows the entries: none before the first, none after the last', () => {
  const map = createSparseInts();
  assert.equal(map.byteLength, 0);
  for (let key = 0; key < 100; key++) map.set(key * 1000, key + 1);
  const full = map.byteLength;
  assert.ok(full >= 100 * 2 * 8 && full <= 100 * 4 * 8, `${full} bytes for 100 entries`);
  for (let key = 0; key < 100; key++) map.set(key * 1000, 0);
  assert.equal(map.byteLength, 0);
  map.set(5, 1);
  map.clear();
  assert.ok(map.byteLength > 0 && map.size === 0, 'a cleared scratch map keeps its storage');
});

test('a grown list keeps what it is asked to keep', () => {
  const list = Int32Array.of(1, 2, 3, 4);
  assert.deepEqual([...grown(list, 6, 3)], [1, 2, 3, 0, 0, 0, 0, 0]);
  assert.equal(grown(list, 20).length, 20);
});
