import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { createLightCutRedraws } from './lightCutRedraws.ts';
import { COARSER_VIEWS, WORK_DROPPED } from './shader/viewsWgsl.ts';
import { MAX_SHADOW_BATCHES, SHADOW_FLAG_FRAMES } from '../shadow/batchBudget.ts';
import {
  DRAW_ALL,
  DRAW_DYNAMIC,
  DRAW_FULL,
} from '../../../../sdk-core/src/scene/light-shadow/pool.ts';

/** Modes of pages drawn whole: static casters and moving ones. */
const WHOLE = new Array<number>(8).fill(DRAW_FULL);
const coarserView = (view: number) => (1 << (COARSER_VIEWS + view)) >>> 0;

/** A light cut's flag readback whose word is `flag.value`, and one frame through it. */
function redrawsWith(flag: { value: number }) {
  installGpuGlobals();
  const made: GPUBufferDescriptor[] = [];
  const buffer = (descriptor: GPUBufferDescriptor) => {
    made.push(descriptor);
    return {
      mapAsync: () => Promise.resolve(),
      getMappedRange: () => new Uint32Array(descriptor.size / 4).fill(flag.value).buffer,
      unmap() {},
    } as unknown as GPUBuffer;
  };
  const redraws = createLightCutRedraws(buffer, {} as GPUBuffer, 24);
  const encoder = { copyBufferToBuffer() {} } as unknown as GPUCommandEncoder;
  const taken = () => {
    const again: number[] = [];
    redraws.takeRedraw((page) => again.push(page));
    return again;
  };
  const frame = async (pages: number[], reported = true, views?: number[]) => {
    const settle = redraws.encode(encoder, pages, views ?? pages.map(() => 0), pages.length, WHOLE);
    redraws.reported(reported);
    settle?.(true);
    await redraws.settled();
    return taken();
  };
  return { redraws, encoder, frame, taken, made };
}

// A frame whose light cut dropped work drew its pages without all their casters: they are drawn
// again, in fewer views a frame, and the limit comes back once frames stay whole. It bounds views,
// never pages: one view never drops, so any number of pages still drains.
test('the pages of a frame that dropped work are drawn again, in fewer views until none drops', async () => {
  const flag = { value: WORK_DROPPED };
  const { redraws, encoder, frame } = redrawsWith(flag);
  assert.equal(
    redraws.encode(encoder, [], [], 0, WHOLE),
    undefined,
    'a frame without pages copies nothing',
  );
  assert.deepEqual(await frame([4, 9, 12, 20], true, [0, 1, 2, 3]), [4, 9, 12, 20], 'all again');
  assert.equal(redraws.limit.value, 2, 'half the views that dropped');
  assert.equal(redraws.unsettled, false);
  flag.value = 0;
  assert.deepEqual(await frame([4, 9], true, [0, 1]), [], 'whole: nothing drawn again');
  assert.equal(redraws.limit.value, 3, 'bisected between what fitted and what dropped');
  flag.value = WORK_DROPPED;
  await frame([4, 9, 12], true, [0, 1, 2]);
  assert.equal(redraws.limit.value, 2, 'three dropped, two fitted: it stays at two');
  flag.value = 0;
  await frame([4, 9, 12, 20, 21], true, [0, 0, 0, 1, 1]);
  assert.equal(redraws.limit.value, 2, 'five pages in two views fit: no swing back to three');
  redraws.residencyChanged();
  assert.equal(redraws.limit.value, 2, 'residency moved: the drop goes stale, the limit stays');
  flag.value = WORK_DROPPED;
  assert.deepEqual(await frame([1, 2], true, [0, 1]), [1, 2], 'dropped: drawn again');
  for (let i = 0; i < 5; i++) await frame([1, 2], true, [0, 1]);
  assert.equal(redraws.limit.value, 1, 'drops floor the limit at one view');
});

// A view drew a placement coarser than it wanted: every page it drew waits for residency to move
// and the camera to rest, and is then drawn again — a cluster that never comes costs nothing, and a
// camera that only moves redraws none of them.
test('the pages a view drew coarse are drawn again once residency changes at rest, and only then', async () => {
  const { redraws, frame, taken } = redrawsWith({ value: coarserView(0) });
  assert.deepEqual(await frame([3, 7]), [], 'nothing arrived yet: they wait');
  assert.equal(redraws.unsettled, false, 'a wait for residency holds no image');
  redraws.rest();
  assert.deepEqual(taken(), [], 'at rest, residency unchanged: they still wait');
  redraws.residencyChanged();
  assert.deepEqual(taken(), [], 'the camera moves: no redraw');
  assert.equal(redraws.unsettled, true, 'the next rest releases them');
  redraws.rest();
  assert.deepEqual(taken(), [3, 7], 'residency moved, the camera rests: drawn again');
  assert.equal(redraws.limit.value, 24, 'coarse is not a drop: the limit stays');
});

// A frame whose requests were never copied cannot wait on them: its coarse pages are drawn again.
test('the coarse pages of a frame whose requests were not copied are drawn again at once', async () => {
  const { frame } = redrawsWith({ value: coarserView(0) });
  assert.deepEqual(await frame([5, 6], false), [5, 6]);
});

// Every frame's read joins the settlement without keeping the previous ones' values alive.
test('the settlement of the flag reads holds no value from one frame to the next', async () => {
  const { redraws, frame } = redrawsWith({ value: 0 });
  for (let i = 0; i < 3; i++) await frame([i]);
  assert.equal(await redraws.settled(), undefined);
});

// Only the views that drew coarser wait: the pages of a view that drew what it wanted are done.
test('only the pages of the views that drew coarser wait for residency', async () => {
  const { redraws, frame, taken } = redrawsWith({ value: coarserView(1) });
  assert.deepEqual(await frame([3, 7, 8], true, [0, 1, 2]), []);
  redraws.residencyChanged();
  redraws.rest();
  assert.deepEqual(taken(), [7]);
});

// Dropped work leaves pages without casters: wrong, they are withdrawn until redrawn. A coarse view
// drew the same casters at another precision: its pages stay read.
test('only the pages of a frame that dropped work are withdrawn until they are redrawn', async () => {
  const flag = { value: WORK_DROPPED };
  const { redraws, encoder } = redrawsWith(flag);
  const drawn = async (page: number, reported: boolean) => {
    const settle = redraws.encode(encoder, [page], [0], 1, WHOLE);
    redraws.reported(reported);
    settle?.(true);
    await redraws.settled();
    const seen: [number, boolean][] = [];
    redraws.takeRedraw((again, withdraw) => seen.push([again, withdraw]));
    return seen;
  };
  assert.deepEqual(await drawn(4, true), [[4, true]], 'dropped: withdrawn');
  flag.value = coarserView(0);
  assert.deepEqual(await drawn(5, false), [[5, false]], 'coarse: still read');
});

// A frame draws as many batches as its pages take (#489): each frame's flag words ride in one slot
// sized for the most batches a frame draws, the slots are made once, and none grows at run time.
test('the flag slots are made once, for the most batches a frame draws, and never grow', async () => {
  const { redraws, encoder, taken, made } = redrawsWith({ value: 0 });
  assert.equal(made.length, SHADOW_FLAG_FRAMES, 'one slot per frame in flight, made at creation');
  assert.ok(
    made.every(({ size }) => size === MAX_SHADOW_BATCHES * 4),
    'a word per batch',
  );
  const settles = [];
  for (let frame = 0; frame < SHADOW_FLAG_FRAMES; frame++) {
    const settle = redraws.encode(encoder, [0], [0], 1, WHOLE);
    for (let batch = 1; batch < MAX_SHADOW_BATCHES; batch++)
      assert.equal(redraws.encode(encoder, [batch], [0], 1, WHOLE), undefined, 'same slot');
    assert.ok(settle, 'the first batch opens the frame');
    redraws.reported(true);
    settle(true);
    settles.push(settle);
  }
  assert.equal(made.length, SHADOW_FLAG_FRAMES, 'nothing made at run time');
  assert.deepEqual(taken(), [], 'no batch drawn again for want of a slot');
  await redraws.settled();
  assert.deepEqual(taken(), [], 'whole: nothing drawn again once read');
});

// A GPU so far behind that every slot is still being read: the frame cannot know what its cuts
// drew short, so its pages are drawn again, withdrawn meanwhile — never read on a guess.
test('a frame that finds every flag slot still read draws its pages again, withdrawn', () => {
  const { redraws, encoder } = redrawsWith({ value: 0 });
  for (let frame = 0; frame < SHADOW_FLAG_FRAMES; frame++)
    redraws.encode(encoder, [frame], [0], 1, WHOLE)!(true);
  assert.equal(redraws.encode(encoder, [40, 41], [0, 0], 2, WHOLE), undefined);
  const seen: [number, boolean][] = [];
  redraws.takeRedraw((page, withdraw) => seen.push([page, withdraw]));
  assert.deepEqual(seen, [
    [40, true],
    [41, true],
  ]);
});

// #990: a page restored from the static layer drew its moving casters alone; drawn short, only they
// are drawn again. A page whose static casters were drawn draws them again, also
// when it waited for residency.
test('a page drawn short is drawn again as it was drawn: its static casters only if it drew them', async () => {
  const flag = { value: WORK_DROPPED };
  const { redraws, encoder } = redrawsWith(flag);
  const drawn = async (pages: number[], modes: number[]) => {
    redraws.encode(encoder, pages, [0, 0, 0], pages.length, modes)?.(true);
    await redraws.settled();
  };
  /** The pages drawn again, by whether their static casters are too. */
  const seen = () => {
    const again = { whole: [] as number[], moving: [] as number[] };
    redraws.takeRedraw((page, _, whole) => again[whole ? 'whole' : 'moving'].push(page));
    return again;
  };
  await drawn([1, 2, 3], [DRAW_DYNAMIC, DRAW_FULL, DRAW_ALL]);
  assert.deepEqual(seen(), { whole: [2, 3], moving: [1] });
  flag.value = coarserView(0);
  await drawn([5, 6], [DRAW_FULL, DRAW_DYNAMIC]);
  await drawn([5], [DRAW_DYNAMIC]);
  redraws.residencyChanged();
  redraws.rest();
  assert.deepEqual(seen(), { whole: [5], moving: [6] }, 'a wait keeps what its first draw lacked');
});
