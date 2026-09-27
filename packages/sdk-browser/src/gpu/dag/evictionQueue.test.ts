// The EVICTION QUEUE a resident GPU cut publishes (#872): run on the Node device, which replays
// the stamps and `dagListEvictions` through their CPU mirrors (`tests/kit/gpu/mockEvict.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { createGpuDagSelection } from './selection.ts';
import { requestScene } from './requestScene.fixture.ts';
import { KEY_PAGE_BITS, canonicalPage, listEvictions } from './evict.ts';
import { EVICTION_BURST, keyBase } from './layout.ts';

/** Four placements of one page set, every page resident for the rule; `cut()` cuts, reads back. */
async function residentCut(leaves = 256) {
  installGpuGlobals();
  const scene = requestScene(4, leaves, 4),
    { packed } = scene;
  const gpu = mockGpu({ packed });
  const selection = await createGpuDagSelection(gpu.device, packed, { residentCut: true });
  assert.ok(selection);
  selection.updateResidency(new Uint32Array(packed.pageCount).fill(1));
  const keys = new Uint32Array(packed.pageCones.buffer).subarray(keyBase(packed.pageCount));
  const cut = async () => {
    selection.dispatch(scene.uni);
    const result = await selection.flush();
    assert.ok(result?.evictPageIds);
    return { result, queue: [...result.evictPageIds] };
  };
  const holdAll = () => {
    for (let page = 0; page < packed.pageCount; page++) selection.notePool(page, true);
  };
  const readbacks = () => gpu.buffers.filter((b) => b.usage & GPUMapMode.READ).map((b) => b.size);
  return {
    selection,
    holdAll,
    readbacks,
    keys,
    cut,
    levelOf: (page: number) => keys[page] >>> KEY_PAGE_BITS,
  };
}

test('each key once, children before parents, never one the cut read by any placement', async () => {
  const { holdAll, keys, levelOf, cut } = await residentCut();
  holdAll();
  const { result, queue } = await cut();
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

test('the queue lists what the pool holds, whatever the rule reads, and no more', async () => {
  const { selection, holdAll, cut } = await residentCut();
  // The rule reads every page resident; the pool holds three keys the cut leaves: three listed.
  assert.deepEqual((await cut()).queue, []);
  holdAll();
  const listed = (await cut()).queue;
  for (const page of listed.slice(3)) selection.notePool(page, false);
  assert.deepEqual(new Set((await cut()).queue), new Set(listed.slice(0, 3)));
  // The pool gives one back and takes it again: the list follows each move.
  selection.notePool(listed[0], false);
  assert.deepEqual(new Set((await cut()).queue), new Set(listed.slice(1, 3)));
});

test('the mirror ranks finer first, then older first, and skips the pages used now', () => {
  // Pages 0..3: level 1 used at 1, level 0 used at 6, level 0 used at 1, level 0 used now.
  const keys = Uint32Array.from([1 << KEY_PAGE_BITS, 1, 2, 3]),
    stampOf = (page: number) => [1, 6, 1, 9][page];
  const order = listEvictions({ pool: [0, 1, 2, 3], keys, stampOf, now: 9, cap: 8 });
  assert.deepEqual(order, [2, 1, 0]);
});

test('the readback is the same size whatever the pool holds: one burst per readback', async () => {
  const { holdAll, readbacks, cut } = await residentCut(2048);
  const empty = (await cut()).queue,
    sizes = readbacks();
  holdAll();
  assert.deepEqual([empty.length, (await cut()).queue.length], [0, EVICTION_BURST]);
  assert.deepEqual(readbacks(), sizes);
});
