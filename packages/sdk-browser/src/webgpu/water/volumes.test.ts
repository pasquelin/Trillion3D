import test from 'node:test';
import assert from 'node:assert/strict';
import { waterRankOf, writeVolumeRecords, VOLUME_WORDS } from '../transparent/transmission.ts';
import { FLAG_TRANSMISSIVE } from '../../visibility/buffer.ts';
import { device, prepared } from './pass.fixture.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

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
  assert.deepEqual(
    blendState.blendGpu.map((item) => waterRankOf(item.flags)),
    [0, 1, 0],
    'the water rank rides above the flags, one-based, zero for a blend',
  );
});

test("the material's glTF volume reaches the composite at the item's water rank, and nothing else does", () => {
  const { blendState, gpu } = prepared();
  const rt = { gpu, blendState } as unknown as WebgpuPagesRuntime;
  writeVolumeRecords(rt, device);
  const volume = blendState.volumePacked;
  assert.equal(volume.length, VOLUME_WORDS, 'one record: the transmissive item, at rank zero');
  const arrondi = (value: number) => Math.round(value * 100) / 100;
  assert.deepEqual(Array.from(volume.subarray(0, 4)).map(arrondi), [1, 1.33, 2.5, 6]);
  assert.deepEqual(Array.from(volume.subarray(4, 7)).map(arrondi), [0.35, 0.72, 0.68]);
});
