// #1211: the request readback carries, beside the list, the frame's whole cell table and whether
// the image lit a blend or water surface — what a page's footprint is grown from a frame later.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ShadowRequestReport } from '../../../../sdk-core/src/scene/light-shadow/requests.ts';
import { shadowRequestCap } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { shadowCellWords, shadowRequestBits } from '../../lighting/direct/shadowRequestWgsl.ts';
import { createShadowPageRequests } from './pageRequests.ts';

test('a copy reads back the list, the whole cell table and the transparent flag', async () => {
  installGpuGlobals();
  const { device } = mockGpu({ compute: true }) as unknown as { device: GPUDevice };
  const requests = createShadowPageRequests(device, 16),
    cap = shadowRequestCap(16),
    words = new Uint32Array((requests.buffer as unknown as { data: Uint8Array }).data.buffer),
    table = 1 + cap + shadowRequestBits();
  words.set([1, 7]);
  // Page 7 read in cells 0 and 5; the last slot of the table taken too.
  words.set([0, 8, 0b100001], table);
  words.set([4, 3], table + shadowCellWords(cap) - 2);
  for (const transparent of [false, true]) {
    let read: ShadowRequestReport | undefined;
    const encoder = device.createCommandEncoder(),
      settle = requests.copy(encoder, 1, 0, 0, (r) => (read = r), false, transparent);
    settle?.(true);
    await requests.settled();
    assert.deepEqual([...read!.entries.subarray(0, read!.count)], [7]);
    assert.deepEqual([...read!.cells!.subarray(0, 3)], [0, 8, 0b100001]);
    assert.deepEqual([...read!.cells!.subarray(-2)], [4, 3], 'read whole');
    assert.equal(read!.transparent, transparent);
  }
  requests.dispose();
});
