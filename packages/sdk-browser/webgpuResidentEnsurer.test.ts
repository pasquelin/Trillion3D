import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuPageTracking } from './webgpuPageTracking.ts';
import { createWebgpuResidentEnsurer } from './webgpuResidentEnsurer.ts';
import type { PageRec } from './pageSelection.ts';

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
  createWebgpuResidentEnsurer({
    getCache: () => cache as never,
    tracking,
    bootstrapKey: new Uint8Array(tracking.keyCount),
    hasBytes: () => true,
    isLost: () => false,
    traceEnabled: false,
    traceDiagnostic: () => {},
  });

test('a full pool stops the burst without dropping the image; any other error bubbles up', async () => {
  const pages = ['a', 'b', 'c', 'd', 'e'].map((url) => ({
    url,
    array: new Uint8Array(4),
  })) as PageRec[];
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
