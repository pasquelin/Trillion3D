import test from 'node:test';
import assert from 'node:assert/strict';
import { writeVolumeRecords, VOLUME_WORDS } from './webgpuTransmission.ts';
import { FLAG_TRANSMISSIVE } from './visibilityBuffer.ts';
import { device, prepared } from './webgpuWaterPassFixture.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

test('a transmissive surface is prepared like the other blends, and marked', () => {
  const { blendState } = prepared();
  assert.equal(blendState.transmissive, 1, 'only one of the three copies transmits');
  assert.equal(blendState.blendGpu.length, 3, 'no copy is left aside');
  assert.deepEqual(
    blendState.blendGpu.map((item) => (item.flags & FLAG_TRANSMISSIVE) !== 0),
    [false, true, false],
  );
  assert.deepEqual(
    blendState.blendGpu.map((item) => !!item.transmissive),
    [false, true, false],
  );
});

test("the material's glTF volume reaches the composite, entry by entry, at the item's rank", () => {
  const { blendState, gpu } = prepared();
  const rt = { gpu, blendState } as unknown as WebgpuPagesRuntime;
  writeVolumeRecords(rt, device);
  const volume = blendState.volumePacked.subarray(VOLUME_WORDS, VOLUME_WORDS + 8);
  const arrondi = (value: number) => Math.round(value * 100) / 100;
  assert.deepEqual(Array.from(volume.subarray(0, 4)).map(arrondi), [1, 1.33, 2.5, 6]);
  assert.deepEqual(Array.from(volume.subarray(4, 7)).map(arrondi), [0.35, 0.72, 0.68]);
  // A blend without transmission still fills its entry: the composite never reads it, and its
  // value never depends on the neighbour.
  assert.equal(blendState.volumePacked[0], 0);
});
