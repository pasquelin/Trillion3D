import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { createLightCutRedraws } from './lightCutRedraws.ts';
import { WORK_DROPPED, WORK_ESCALATED } from './shader/viewsWgsl.ts';

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
  const frame = async (pages: number[], reported = true) => {
    redraws.encode(encoder, pages, pages.length, reported)?.(true);
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
    redraws.encode(encoder, [], 0, true),
    undefined,
    'a frame without pages copies nothing',
  );
  assert.deepEqual(await frame([4, 9, 12, 20]), [4, 9, 12, 20], 'dropped: all drawn again');
  assert.equal(redraws.pageLimit, 2, 'half the pages that dropped');
  assert.equal(redraws.unsettled, false);
  flag.value = 0;
  assert.deepEqual(await frame([4, 9]), [], 'whole: nothing drawn again');
  assert.equal(redraws.pageLimit, 4, 'the limit doubles back');
});

// A view drew a placement coarser than it wanted: every page it drew waits for residency to move,
// and is then drawn again — a cluster that never comes costs nothing.
test('the pages a view drew coarse are drawn again once residency changes, and only then', async () => {
  const { redraws, frame, taken } = redrawsWith({ value: WORK_ESCALATED });
  assert.deepEqual(await frame([3, 7]), [], 'nothing arrived yet: they wait');
  assert.equal(redraws.unsettled, false, 'a wait for residency holds no image');
  redraws.residencyChanged();
  assert.deepEqual(taken(), [3, 7], 'residency moved: drawn again');
  assert.equal(redraws.pageLimit, 24, 'coarse is not a drop: the limit stays');
});

// A frame whose requests were never copied cannot wait on them: its coarse pages are drawn again.
test('the coarse pages of a frame whose requests were not copied are drawn again at once', async () => {
  const { frame } = redrawsWith({ value: WORK_ESCALATED });
  assert.deepEqual(await frame([5, 6], false), [5, 6]);
});

// Every frame's read joins the settlement without keeping the previous ones' values alive.
test('the settlement of the flag reads holds no value from one frame to the next', async () => {
  const { redraws, frame } = redrawsWith({ value: 0 });
  for (let i = 0; i < 3; i++) await frame([i]);
  assert.equal(await redraws.settled(), undefined);
});
