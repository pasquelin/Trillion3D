// #198: the occluder history is established by the partition alone, and the partition runs only on
// opaque rows. A view with none — blend clusters alone, the sky — never cleared the bit and never
// held its frame. It no longer counts there, and still counts as soon as a row is packed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { unsettledMask, unsettledReasons } from './hold.ts';
import { settledRt } from './hold.fixture.ts';

test('#198: a view without a packed row owes no occluder history', () => {
  const rt = settledRt();
  rt.run.noOccluderHistory = true;
  assert.deepEqual(unsettledReasons(unsettledMask(rt)), ['noOccluderHistory']);
  rt.layout.rows.packedCount = 0;
  assert.equal(unsettledMask(rt), 0, 'nothing to partition: the frame may be held');
  rt.layout.rows.packedCount = 1;
  assert.deepEqual(
    unsettledReasons(unsettledMask(rt)),
    ['noOccluderHistory'],
    'the missing history still waits for the first packed row',
  );
});
