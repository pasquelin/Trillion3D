import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { createLightCutRedraws } from './lightCutRedraws.ts';
import { COARSER_VIEWS, WORK_DROPPED } from './shader/viewsWgsl.ts';

const coarserView = (view: number) => (1 << (COARSER_VIEWS + view)) >>> 0;

/** A light cut's flag readback whose word is `flag.value`, and one frame through it. */
function redrawsWith(flag: { value: number }) {
  installGpuGlobals();
  const buffer = () =>
    ({
      mapAsync: () => Promise.resolve(),
      getMappedRange: () => new Uint32Array([flag.value]).buffer,
      unmap() {},
    }) as unknown as GPUBuffer;
  const redraws = createLightCutRedraws(buffer, {} as GPUBuffer, 24);
  const encoder = { copyBufferToBuffer() {} } as unknown as GPUCommandEncoder;
  const taken = () => {
    const again: number[] = [];
    redraws.takeRedraw((page) => again.push(page));
    return again;
  };
  const frame = async (pages: number[], reported = true, views?: number[]) => {
    redraws.encode(encoder, pages, views ?? pages.map(() => 0), pages.length, reported)?.(true);
    await redraws.settled();
    return taken();
  };
  return { redraws, encoder, frame, taken };
}

// A frame whose light cut dropped work drew its pages without all their casters: they are drawn
// again, in fewer views a frame, and the limit comes back once frames stay whole. It bounds views,
// never pages: one view never drops, so any number of pages still drains.
test('the pages of a frame that dropped work are drawn again, in fewer views until none drops', async () => {
  const flag = { value: WORK_DROPPED };
  const { redraws, encoder, frame } = redrawsWith(flag);
  assert.equal(
    redraws.encode(encoder, [], [], 0, true),
    undefined,
    'a frame without pages copies nothing',
  );
  assert.deepEqual(await frame([4, 9, 12, 20], true, [0, 1, 2, 3]), [4, 9, 12, 20], 'all again');
  assert.equal(redraws.viewLimit, 2, 'half the views that dropped');
  assert.equal(redraws.unsettled, false);
  flag.value = 0;
  assert.deepEqual(await frame([4, 9], true, [0, 1]), [], 'whole: nothing drawn again');
  assert.equal(redraws.viewLimit, 3, 'bisected between what fitted and what dropped');
  flag.value = WORK_DROPPED;
  await frame([4, 9, 12], true, [0, 1, 2]);
  assert.equal(redraws.viewLimit, 2, 'three dropped, two fitted: it stays at two');
  flag.value = 0;
  await frame([4, 9, 12, 20, 21], true, [0, 0, 0, 1, 1]);
  assert.equal(redraws.viewLimit, 2, 'five pages in two views fit: no swing back to three');
  redraws.residencyChanged();
  assert.equal(redraws.viewLimit, 24, 'residency moved: the drop is forgotten');
  flag.value = WORK_DROPPED;
  for (let i = 0; i < 6; i++) await frame([1, 2], true, [0, 1]);
  assert.equal(redraws.viewLimit, 1, 'drops floor the limit at one view');
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
  assert.equal(redraws.viewLimit, 24, 'coarse is not a drop: the limit stays');
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
    redraws.encode(encoder, [page], [0], 1, reported)?.(true);
    await redraws.settled();
    const seen: [number, boolean][] = [];
    redraws.takeRedraw((again, withdraw) => seen.push([again, withdraw]));
    return seen;
  };
  assert.deepEqual(await drawn(4, true), [[4, true]], 'dropped: withdrawn');
  flag.value = coarserView(0);
  assert.deepEqual(await drawn(5, false), [[5, false]], 'coarse: still read');
});
