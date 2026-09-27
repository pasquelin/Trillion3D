// The static layer's page pyramids are built by the camera's Hi-Z kernels, one pyramid per page
// in the same dispatches: level 0 copied from the page's texels, each next level reduced from the
// one before, every pyramid `PAGE_HIZ_WORDS` apart.
import assert from 'node:assert/strict';
import test from 'node:test';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import {
  PAGE_HIZ_LEVELS,
  PAGE_HIZ_OFFSETS,
  PAGE_HIZ_WORDS,
  createShadowPageHiz,
} from './pageHiz.ts';

/** A compute encoder that records the size of each dispatch. */
function recordingEncoder() {
  const dispatches: number[][] = [];
  const pass = {
    setBindGroup() {},
    setPipeline() {},
    dispatchWorkgroups: (...size: number[]) => dispatches.push(size),
    end() {},
  };
  const encoder = { beginComputePass: () => pass } as unknown as GPUCommandEncoder;
  return { encoder, dispatches };
}

test('a page pyramid is 128² then every half down to one texel, one per page', async () => {
  assert.equal(PAGE_HIZ_LEVELS, 8);
  assert.deepEqual(PAGE_HIZ_OFFSETS.slice(0, 3), [0, 16384, 20480]);
  assert.equal(PAGE_HIZ_WORDS, 21845);
  const { device, writes } = fakeDevice();
  const { encoder, dispatches } = recordingEncoder();
  const hiz = await createShadowPageHiz(device, {} as GPUTextureView);
  const slots = new Uint32Array(writes[0].data.buffer),
    slot = (l: number) => Array.from(slots.subarray(l * 64, l * 64 + 20));
  // Two build passes: level 0 read from the layer, copied, and reduced to levels 1 to 4; then
  // level 4 reduced to levels 5 to 7. Each names its source, its levels, its texture, the stride.
  const o = PAGE_HIZ_OFFSETS;
  assert.deepEqual(slot(0), [
    ...[0, 128, 128, 4, 1, 0, PAGE_HIZ_WORDS, 0],
    ...[o[1], 64, 64, 0, o[2], 32, 32, 0, o[3], 16, 16, 0],
  ]);
  assert.deepEqual(slot(1), [
    ...[o[4], 8, 8, 3, 0, 0, PAGE_HIZ_WORDS, 0],
    ...[o[5], 4, 4, 0, o[6], 2, 2, 0, o[7], 1, 1, 0],
  ]);
  assert.deepEqual(Array.from(slots.subarray(128)).filter(Boolean), [], 'no third pass');
  hiz.encode(encoder, 3, (page, out, at) => {
    out[at] = page * 128;
    out[at + 1] = 256;
  });
  assert.deepEqual(
    dispatches,
    [
      [8, 8, 3],
      [1, 1, 3],
    ],
    'three pages at once, four mips per dispatch',
  );
  const origins = new Int32Array(writes[1].data.buffer);
  assert.deepEqual([origins[12], origins[13]], [128, 256], "the second page's first texel");
});
