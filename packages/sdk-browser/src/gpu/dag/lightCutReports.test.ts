import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { createLightCutReports } from './lightCutReports.ts';
import { SELECTION_HEADER_WORDS } from './layout.ts';
import { packRequest } from './request.ts';

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

// Two copies read before one take: neither is lost, and the order is the requests' own — highest
// priority, then highest page —, never the order the GPU appended them in.
test("every copy read before a take joins it, in an order the GPU's atomics do not set", async () => {
  installGpuGlobals();
  const frames = [
    [packRequest(3, 1), packRequest(9, 5)],
    [packRequest(4, 1), packRequest(2, 5)],
  ];
  const done: Array<() => void> = [];
  let copied = 0;
  const own = () => {
    let words: number[] = [];
    return {
      mapAsync: () => new Promise<void>((resolve) => done.push(resolve)),
      getMappedRange: () => {
        const ints = new Uint32Array(SELECTION_HEADER_WORDS + 4);
        ints[0] = words.length;
        ints.set(words, SELECTION_HEADER_WORDS);
        return ints.buffer;
      },
      unmap() {},
      set frame(value: number[]) {
        words = value;
      },
    } as unknown as GPUBuffer;
  };
  const reports = createLightCutReports(own, {} as GPUBuffer, (SELECTION_HEADER_WORDS + 4) * 4);
  const buffers: Array<{ frame: number[] }> = [];
  const encoder = {
    copyBufferToBuffer(_src: unknown, _at: number, dst: { frame: number[] }) {
      dst.frame = frames[copied++];
      buffers.push(dst);
    },
  } as unknown as GPUCommandEncoder;
  reports.encodeReadback(encoder)!(true);
  reports.encodeReadback(encoder)!(true);
  assert.equal(reports.encodeReadback(encoder), undefined, 'both slots read: this frame says so');
  for (const resolve of done) resolve();
  await reports.settled();
  assert.deepEqual(reports.takeRequests(), [9, 2, 4, 3]);
  assert.equal(reports.takeRequests(), null, 'taken once');
});
