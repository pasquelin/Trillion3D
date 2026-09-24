import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { createLightCutReports } from './lightCutReports.ts';

// A light cut's report changes residency only once taken, and its casters load after the frame
// that took it: a barrier stays open from the copy to the take, and one image past it.
test("a light cut's report keeps the shadows unsettled from its copy until it is taken", async () => {
  installGpuGlobals();
  let resolve: () => void = () => {};
  const buffer = {
    mapAsync: () => new Promise<void>((done) => (resolve = done)),
    getMappedRange: () => new ArrayBuffer(64),
    unmap() {},
  } as unknown as GPUBuffer;
  const reports = createLightCutReports(() => buffer, {} as GPUBuffer, 64);
  const encoder = { copyBufferToBuffer() {} } as unknown as GPUCommandEncoder;
  assert.equal(reports.unsettled, false, 'nothing reported yet');
  reports.encodeReadback(encoder)!(true);
  assert.equal(reports.unsettled, true, 'the copy is on its way');
  resolve();
  await reports.settled();
  assert.equal(reports.unsettled, true, 'read, not taken yet');
  assert.equal(reports.takeOffered(), false);
  assert.deepEqual(reports.takeRequests(), []);
  assert.equal(reports.unsettled, false);
  assert.equal(reports.takeOffered(), true, 'taken: its casters may still load');
  assert.equal(reports.takeOffered(), false, 'said once');
});
