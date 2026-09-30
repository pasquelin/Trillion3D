// #1363: the list the GPU pages' pairs land in (`freshPairs.ts`) grows to the need the frames read
// back, and overflows only where the device refuses it: a refused size is not asked again, and a
// need under it is still granted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { PAIR_BYTES, createFreshPairs } from './freshPairs.ts';

test('the pair list overflows only at the device’s ceiling', async () => {
  // A device that grants sixty-four pairs at most.
  const device = fakeDevice({
      refuse: (d) => (Number(d.size) > 64 * PAIR_BYTES ? 'oom' : undefined),
    }),
    list = createFreshPairs(device.device),
    kept = { size: 8 * PAIR_BYTES } as GPUBuffer;
  const ask = async (need: number) => {
    list.need = need;
    list.list(kept);
    await new Promise((settled) => setTimeout(settled, 0));
    return list.list(kept).size / PAIR_BYTES;
  };
  // A hundred pairs: its power of two refused, then the need itself; the list stays as it was.
  assert.equal(await ask(100), 8);
  assert.equal(await ask(100), 8);
  const asked = device.buffers.length;
  assert.equal(await ask(100), 8, 'a refused size is not asked again');
  assert.equal(device.buffers.length, asked);
  // Sixty pairs: its power of two, under the ceiling, granted.
  assert.equal(await ask(60), 64);
});
