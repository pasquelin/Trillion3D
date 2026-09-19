import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuPageCache } from './gpuPages.ts';
import { mockDevice } from '../../test/fixtures/gpuPages.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';

installGpuGlobals();
const LIMITS = { maxBufferSize: 1 << 20, maxStorageBufferBindingSize: 1 << 20 };

test('le réservoir de pages rétrécit en gardant ses pages : copie, déplacement, éviction des dernières', async () => {
  const { device: gpu, copies, destroyed } = mockDevice(LIMITS);
  const cache = createGpuPageCache(
    gpu,
    { read: async () => new Uint8Array(8) },
    { pageBytes: 8, slots: 6 },
  );
  // Six pages, une par fente : a..f. Les fentes partent du haut (5, 4, …).
  for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) await cache.load(key);
  cache.pin('a'); // fente 5, la plus haute : déplacée avant toute éviction
  const before = cache.buffer;
  const evicted = await cache.resize(3);
  // Fentes 0..2 gardées telles quelles (d, e, f) ; a (épinglée), b, c hors réservoir : rien de libre,
  // donc les non épinglées les plus anciennes partent d'abord — b et c —, a reste évincée aussi.
  assert.equal(cache.stats().slots, 3);
  assert.equal(cache.stats().allocatedBytes, 24);
  assert.notEqual(cache.buffer, before);
  assert.equal(destroyed(), 1, 'l’ancien tampon est détruit');
  assert.equal(copies[0].size, 24, 'le préfixe commun est copié en une fois');
  assert.deepEqual(evicted.sort(), ['a', 'b', 'c']);
  assert.ok(cache.get('d') && cache.get('e') && cache.get('f'));
  assert.equal(cache.get('a'), undefined);
  const keys: string[] = [],
    slots: number[] = [];
  cache.drainResidencyChanges(keys, slots);
  assert.deepEqual(keys.slice(-3).sort(), ['a', 'b', 'c']);
  assert.deepEqual(slots.slice(-3), [-1, -1, -1]);
});

test('une page hors réservoir est déplacée dans une fente libre plutôt qu’évincée, et le journal le dit', async () => {
  const { device: gpu, copies } = mockDevice(LIMITS);
  const cache = createGpuPageCache(
    gpu,
    { read: async () => new Uint8Array(8) },
    { pageBytes: 8, slots: 4 },
  );
  await cache.load('a'); // fente 3
  const evicted = await cache.resize(2);
  assert.deepEqual(evicted, []);
  assert.equal(cache.get('a')!.slot, 0, 'déplacée dans la fente libre la plus basse');
  assert.equal(copies.at(-1)!.toOffset, 0);
  assert.equal(copies.at(-1)!.fromOffset, 24);
  const keys: string[] = [],
    slots: number[] = [];
  cache.drainResidencyChanges(keys, slots);
  assert.deepEqual([keys.at(-1), slots.at(-1)], ['a', 0]);
  // Le réservoir grandit de nouveau : rien ne bouge, les fentes neuves sont libres.
  await cache.resize(4);
  await cache.load('b');
  assert.equal(cache.get('b')!.slot, 3);
});
