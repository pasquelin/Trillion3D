import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { createLightCutDrops } from './lightCutDrops.ts';
import { WORK_DROPPED } from './shader/viewsWgsl.ts';

// A frame whose light cut dropped work drew its pages without all their casters: they are drawn
// again, fewer at a time, and the limit comes back once frames stay whole.
test('the pages of a frame that dropped work are drawn again, and fewer a frame until none drops', async () => {
  installGpuGlobals();
  let flag = WORK_DROPPED;
  const buffer = () =>
    ({
      mapAsync: () => Promise.resolve(),
      getMappedRange: () => new Uint32Array([flag]).buffer,
      unmap() {},
    }) as unknown as GPUBuffer;
  const drops = createLightCutDrops(buffer, {} as GPUBuffer, 24);
  const encoder = { copyBufferToBuffer() {} } as unknown as GPUCommandEncoder;
  const frame = async (pages: number[]) => {
    drops.encode(encoder, pages, pages.length)?.(true);
    await drops.settled();
    const again: number[] = [];
    drops.takeRedraw((page) => again.push(page));
    return again;
  };
  assert.equal(drops.encode(encoder, [], 0), undefined, 'a frame without pages copies nothing');
  assert.deepEqual(await frame([4, 9, 12, 20]), [4, 9, 12, 20], 'dropped: all drawn again');
  assert.equal(drops.pageLimit, 2, 'half the pages that dropped');
  assert.equal(drops.unsettled, false);
  flag = 0;
  assert.deepEqual(await frame([4, 9]), [], 'whole: nothing drawn again');
  assert.equal(drops.pageLimit, 4, 'the limit doubles back');
});
