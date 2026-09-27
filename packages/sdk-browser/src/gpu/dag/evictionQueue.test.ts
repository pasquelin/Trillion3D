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

/** Four placements of one page set, every page in the pool; `cut(slots)` cuts and reads back. */
async function residentCut() {
  installGpuGlobals();
  const scene = requestScene(4, 256, 4),
    { packed } = scene;
  const gpu = mockGpu({ packed });
  const selection = await createGpuDagSelection(gpu.device, packed, { residentCut: true });
  assert.ok(selection);
  selection.updateResidency(new Uint32Array(packed.pageCount).fill(1));
  for (let page = 0; page < packed.pageCount; page++) selection.notePool(page, true);
  const keys = new Uint32Array(packed.pageCones.buffer).subarray(keyBase(packed.pageCount));
  const cut = async (slots: number) => {
    selection.setPoolSlots(slots);
    selection.dispatch(scene.uni);
    const result = await selection.flush();
    assert.ok(result?.evictPageIds);
    return { result, queue: [...result.evictPageIds] };
  };
  return { selection, keys, cut, levelOf: (page: number) => keys[page] >>> KEY_PAGE_BITS };
}
const WIDE = 1 << 20;

test('each key once, children before parents, never one the cut read by any placement', async () => {
  const { keys, levelOf, cut } = await residentCut();
  const { result, queue } = await cut(WIDE);
  assert.ok(queue.length > 10, 'the cut must leave pages to evict');
  assert.equal(new Set(queue).size, queue.length);
  for (const page of queue) assert.equal(canonicalPage(keys[page]), page);
  // A parent's level is above its children's: never a coarser page ahead of a finer one.
  assert.ok(new Set(queue.map(levelOf)).size > 1, 'the queue must span levels');
  for (let i = 1; i < queue.length; i++)
    assert.ok(levelOf(queue[i - 1]) <= levelOf(queue[i]), `a parent leaves before a child at ${i}`);
  const read = [...result.pageIds, ...(result.drawablePageIds ?? [])];
  assert.ok(
    read.some((page) => canonicalPage(keys[page]) !== page),
    'a later placement reads',
  );
  for (const page of read) assert.ok(!queue.includes(canonicalPage(keys[page])), `${page} listed`);
});

test('the queue lists what the pool holds, up to its slots, whatever the rule reads', async () => {
  const { selection, keys, cut } = await residentCut();
  const bounded = (await cut(3)).queue,
    listed = (await cut(WIDE)).queue;
  assert.equal(bounded.length, 3);
  // Within a rank the threads' order is free: compare ranks. No listed page was ever used.
  const rankOf = (page: number) => evictionRank(keys[page], 1);
  assert.deepEqual(bounded.map(rankOf), listed.slice(0, 3).map(rankOf));
  // The pool gives half the listed keys back; the rule still reads every page resident.
  const back = new Set(listed.filter((_, i) => i % 2));
  for (const page of back) selection.notePool(page, false);
  const queue = (await cut(WIDE)).queue;
  assert.deepEqual(new Set(queue), new Set(listed.filter((page) => !back.has(page))));
});

test('the mirror ranks finer first, then older first, and skips the pages used now', () => {
  // Pages 0..3: level 1 used at 1, level 0 used at 6, level 0 used at 1, level 0 used now.
  const keys = Uint32Array.from([1 << KEY_PAGE_BITS, 1, 2, 3]),
    stampOf = (page: number) => [1, 6, 1, 9][page];
  const order = listEvictions({ pool: [0, 1, 2, 3], keys, stampOf, now: 9, cap: 8 });
  assert.deepEqual(order, [2, 1, 0]);
});
