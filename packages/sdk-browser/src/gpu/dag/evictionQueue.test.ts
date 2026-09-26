// The EVICTION QUEUE a resident GPU cut publishes (#872): run on the Node device, which replays
// the stamps and `dagListEvictions` through their CPU mirrors (`tests/kit/gpu/mockEvict.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { createGpuDagSelection } from './selection.ts';
import { requestScene } from './requestScene.fixture.ts';
import { KEY_PAGE_BITS, canonicalPage, evictionRank, listEvictions } from './evict.ts';
import { keyBase } from './layout.ts';

/** Four placements of one page set, every page in the pool: each call cuts with the pool at
 *  `slots` and returns the queue. */
async function residentCut() {
  installGpuGlobals();
  const scene = requestScene(4, 256, 4),
    { packed } = scene;
  const gpu = mockGpu({ packed });
  const selection = await createGpuDagSelection(gpu.device, packed, { residentCut: true });
  assert.ok(selection);
  selection.updateResidency(new Uint32Array(packed.pageCount).fill(1));
  const keys = new Uint32Array(packed.pageCones.buffer).subarray(keyBase(packed.pageCount));
  const cut = async (slots: number) => {
    selection.setPoolSlots(slots);
    selection.dispatch(scene.uni);
    const result = await selection.flush();
    assert.ok(result?.evictPageIds);
    return { result, queue: [...result.evictPageIds] };
  };
  return { scene, keys, cut, levelOf: (page: number) => keys[page] >>> KEY_PAGE_BITS };
}
const WIDE = 1 << 20;

test('the queue lists each key once, at its canonical page, children before parents', async () => {
  const { scene, keys, levelOf, cut } = await residentCut();
  const { queue } = await cut(WIDE);
  const { pages, packed } = scene;
  assert.ok(queue.length > 10, 'the cut must leave pages to evict');
  // One key per address: the four placements share theirs, and only the first page names it.
  assert.equal(new Set(queue).size, queue.length);
  for (const page of queue) assert.equal(canonicalPage(keys[page]), page);
  assert.ok(
    queue.every((page) => page < pages.length),
    'canonical pages are the first placement',
  );
  assert.ok(packed.pageCount === 4 * pages.length);
  // A parent's level is above its children's: never a coarser page ahead of a finer one.
  assert.ok(new Set(queue.map(levelOf)).size > 1, 'the queue must span levels');
  for (let i = 1; i < queue.length; i++)
    assert.ok(levelOf(queue[i - 1]) <= levelOf(queue[i]), `a parent leaves before a child at ${i}`);
});

test('a page the cut read this frame is never listed, whatever placement read it', async () => {
  const { keys, cut } = await residentCut();
  const { result, queue } = await cut(WIDE);
  const read = [...result.pageIds, ...(result.drawablePageIds ?? [])];
  assert.ok(
    read.some((page) => canonicalPage(keys[page]) !== page),
    'a later placement reads',
  );
  const listed = new Set(queue);
  for (const page of read) assert.ok(!listed.has(canonicalPage(keys[page])), `page ${page} listed`);
});

test('the queue stops at the pool slots, keeping its first ranks, and follows a resize', async () => {
  const { keys, cut } = await residentCut();
  const bounded = (await cut(3)).queue;
  const whole = (await cut(WIDE)).queue;
  assert.equal(bounded.length, 3);
  assert.ok(whole.length > 3, 'a wider pool lists more on the next cut');
  // Within a rank the threads' order is free: compare the ranks the bound kept. No listed page was
  // ever used, so every page of one cut is as old as the others.
  const rankOf = (page: number) => evictionRank(keys[page], 1);
  assert.deepEqual(bounded.map(rankOf), whole.slice(0, 3).map(rankOf));
});

test('the mirror ranks finer first, then older first, and skips the pages used now', () => {
  // Pages 0..3: level 1 used at 1, level 0 used at 6, level 0 used at 1, level 0 used now.
  const keys = Uint32Array.from([(1 << 22) | 0, 1, 2, 3]),
    stamps = [1, 6, 1, 9];
  const order = listEvictions({
    pool: Uint32Array.of(0b1111),
    keys,
    stampOf: (page) => stamps[page],
    now: 9,
    cap: 8,
  });
  assert.deepEqual(order, [2, 1, 0]);
});
