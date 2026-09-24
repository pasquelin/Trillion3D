import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { createLightCutRedraws } from './lightCutRedraws.ts';
import { ESCALATED_VIEWS, WORK_DROPPED } from './shader/viewsWgsl.ts';

const escalatedView = (view: number) => (1 << (ESCALATED_VIEWS + view)) >>> 0;

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
// again, fewer at a time, and the limit comes back once frames stay whole.
test('the pages of a frame that dropped work are drawn again, and fewer a frame until none drops', async () => {
  const flag = { value: WORK_DROPPED };
  const { redraws, encoder, frame } = redrawsWith(flag);
  assert.equal(
    redraws.encode(encoder, [], [], 0, true),
    undefined,
    'a frame without pages copies nothing',
  );
  assert.deepEqual(await frame([4, 9, 12, 20]), [4, 9, 12, 20], 'dropped: all drawn again');
  assert.equal(redraws.pageLimit, 2, 'half the pages that dropped');
  assert.equal(redraws.unsettled, false);
  flag.value = 0;
  assert.deepEqual(await frame([4, 9]), [], 'whole: nothing drawn again');
  assert.equal(redraws.pageLimit, 3, 'bisected between what fitted and what dropped');
  flag.value = WORK_DROPPED;
  await frame([4, 9, 12]);
  assert.equal(redraws.pageLimit, 2, 'three dropped, two fitted: it stays at two');
  flag.value = 0;
  await frame([4, 9]);
  assert.equal(redraws.pageLimit, 2, 'no swing back to what dropped');
  redraws.residencyChanged();
  assert.equal(redraws.pageLimit, 24, 'residency moved: the drop is forgotten');
});

// A view drew a placement coarser than it wanted: every page it drew waits for residency to move,
// and is then drawn again — a cluster that never comes costs nothing.
test('the pages a view drew coarse are drawn again once residency changes, and only then', async () => {
  const { redraws, frame, taken } = redrawsWith({ value: escalatedView(0) });
  assert.deepEqual(await frame([3, 7]), [], 'nothing arrived yet: they wait');
  assert.equal(redraws.unsettled, false, 'a wait for residency holds no image');
  redraws.residencyChanged();
  assert.deepEqual(taken(), [3, 7], 'residency moved: drawn again');
  assert.equal(redraws.pageLimit, 24, 'coarse is not a drop: the limit stays');
});

// A frame whose requests were never copied cannot wait on them: its coarse pages are drawn again.
test('the coarse pages of a frame whose requests were not copied are drawn again at once', async () => {
  const { frame } = redrawsWith({ value: escalatedView(0) });
  assert.deepEqual(await frame([5, 6], false), [5, 6]);
});

// Every frame's read joins the settlement without keeping the previous ones' values alive.
test('the settlement of the flag reads holds no value from one frame to the next', async () => {
  const { redraws, frame } = redrawsWith({ value: 0 });
  for (let i = 0; i < 3; i++) await frame([i]);
  assert.equal(await redraws.settled(), undefined);
});

// Only the views that escalated wait: the pages of a view that drew what it wanted are done.
test('only the pages of the views that escalated wait for residency', async () => {
  const { redraws, frame, taken } = redrawsWith({ value: escalatedView(1) });
  assert.deepEqual(await frame([3, 7, 8], true, [0, 1, 2]), []);
  redraws.residencyChanged();
  assert.deepEqual(taken(), [7]);
});
