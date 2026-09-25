// The residency queue's main-thread share of a frame (#488): published, never exceeded, and spent in
// one go when the frame has room — no fixed slice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STREAMING_FRAME_MS } from '../../backend/common.ts';
import { createWebgpuPageTracking } from '../row/pageTracking.ts';
import { createFrameBudget } from './frameBudget.ts';
import { lruCache, pageOf, tierEnsurer } from './residentEnsurer.fixture.ts';

/** Twelve camera pages, each admission costing `cost` ms on a clock the test owns; each display
 *  frame is one task, and the share each frame spent is recorded. */
async function admit(cost: number) {
  const pages = Array.from({ length: 12 }, (_, i) => pageOf(`p${i}`));
  const tracking = createWebgpuPageTracking(pages);
  for (const page of pages) tracking.wanted.add(tracking.keyOf(page), page);
  const cache = lruCache(16),
    load = cache.load;
  let clock = 0;
  const spent = [0];
  cache.load = async (url: string) => {
    clock += cost;
    spent[spent.length - 1] += cost;
    await load(url);
  };
  const budget = createFrameBudget({
    now: () => clock,
    nextFrame: () => new Promise<void>((done) => setImmediate(() => (spent.push(0), done()))),
  });
  await tierEnsurer(
    tracking,
    cache,
    () => [],
    () => [],
    budget,
  )(pages, 1, 1);
  return { resident: cache.resident.size, spent: spent.filter((ms) => ms > 0) };
}

test('the main-thread admission never exceeds the published share of a frame', async () => {
  const { resident, spent } = await admit(STREAMING_FRAME_MS * 0.3);
  assert.equal(resident, 12, 'every page admitted');
  assert.ok(spent.length > 1, 'across several frames');
  for (const ms of spent) assert.ok(ms <= STREAMING_FRAME_MS + 1e-9, `${ms} ms in one frame`);
});

test('a frame with room admits in one go, without a fixed slice', async () => {
  const { resident, spent } = await admit(STREAMING_FRAME_MS / 100);
  assert.equal(resident, 12);
  assert.equal(spent.length, 1, 'the whole burst fits one frame');
});
