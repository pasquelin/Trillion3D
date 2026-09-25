import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuPageTracking } from '../row/pageTracking.ts';
import { lruCache, pageOf, tierEnsurer } from './residentEnsurer.fixture.ts';

/** A cache of three slots all pinned: the fourth page cannot enter. */
function saturatedCache(resident: string[], error = 'ALL_PAGES_PINNED') {
  const held = new Set(resident);
  return {
    get: (url: string) => (held.has(url) ? { key: url } : undefined),
    async load(url: string) {
      if (held.size >= 3) throw new Error(error);
      held.add(url);
    },
    pin() {},
  };
}

const ensurer = (tracking: ReturnType<typeof createWebgpuPageTracking>, cache: unknown) =>
  tierEnsurer(tracking, cache, () => []);

test('a full pool stops the burst without dropping the image; any other error bubbles up', async () => {
  const pages = ['a', 'b', 'c', 'd', 'e'].map(pageOf);
  const tracking = createWebgpuPageTracking(pages);
  for (const page of pages) tracking.wanted.add(tracking.keyOf(page), page);
  const cache = saturatedCache(['a', 'b']);
  await ensurer(tracking, cache)(pages, 1, 1);
  // `c` entered (third slot), `d` found the pool full: the burst stops, `d` and `e` stay wanted and
  // outside — they display through their resident ancestor, and cut admission reads the state
  // (`keepCount > slots`) to grow the screen error.
  assert.ok(cache.get('c'));
  assert.equal(cache.get('d'), undefined);
  await assert.rejects(
    ensurer(tracking, saturatedCache(['a', 'b', 'c'], 'WEBGPU_LOST'))([pages[3]], 2, 2),
    /WEBGPU_LOST/,
  );
});

test('a page both lower tiers name is counted once: the slots it leaves are filled', async () => {
  const pages = ['both', 'x', 'y'].map(pageOf);
  const [both, x, y] = pages;
  const tracking = createWebgpuPageTracking(pages);
  const cache = lruCache(3);
  await cache.load('both');
  // A caster also ahead of the camera: one resident page, two free slots for the rest.
  await tierEnsurer(
    tracking,
    cache,
    () => [both],
    () => [both, x, y],
  )([], 1, 1);
  assert.deepEqual([...cache.resident.keys()].sort(), ['both', 'x', 'y']);
});

test('shadow casters fill only what the camera leaves: never pinned, never evicting its pages', async () => {
  const pages = ['cam0', 'cam1', 'cam2', 'old', 'sh0', 'sh1', 'sh2'].map(pageOf);
  const [cam0, cam1, cam2, , sh0, sh1, sh2] = pages;
  const tracking = createWebgpuPageTracking(pages);
  for (const page of [cam0, cam1]) tracking.wanted.add(tracking.keyOf(page), page);
  const cache = lruCache(4);
  await cache.load('old');
  await cache.load('sh0');
  let lower = [sh0, sh1, sh2];
  const ensure = tierEnsurer(tracking, cache, () => lower);
  await ensure([cam0, cam1], 1, 1);
  // The camera's two pages took the two free slots and are pinned; `old` and `sh0` remain.
  // Two unpinned slots, one of them already a caster: one more caster enters, in `old`'s slot.
  assert.deepEqual([...cache.resident.keys()].sort(), ['cam0', 'cam1', 'sh0', 'sh1']);
  assert.deepEqual([...cache.pins].sort(), ['cam0', 'cam1'], 'no caster is pinned');
  // The camera wants a third page: it takes a caster's slot, and the casters still wanted keep
  // theirs — the one left over is not evicted for another caster.
  tracking.wanted.add(tracking.keyOf(cam2), cam2);
  lower = [sh1, sh2];
  await ensure([cam0, cam1, cam2], 2, 2);
  assert.ok(cache.get('cam2'), 'the camera page entered');
  assert.equal(cache.get('sh0'), undefined, 'by the slot of a caster');
  assert.ok(cache.get('sh1'), 'the caster still wanted stays');
  assert.equal(cache.get('sh2'), undefined, 'and no other caster takes its place');
});
