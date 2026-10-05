// The partition's frame on the host: what it does before its pass (nothing cleared from the
// encoder but forgotten rows), then its three dispatches in the frame's pass, opened only when it
// runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuPartition } from './factory.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { recordingEncoder } from '../../../../../tests/kit/gpu/usageScope.ts';
import type { PartitionFrame } from './uniform.ts';

const buffer = (label: string) => ({ label, size: 4, destroy() {} }) as unknown as GPUBuffer;
const frame = (rows: number): PartitionFrame => ({
  view: new Float64Array(16),
  viewProj: new Float64Array(16),
  anchor: [0, 0, 0],
  near: 0.1,
  rows,
  width: 8,
  height: 8,
  levels: [{ offset: 0, width: 8 }],
  layerTop: 0,
  hasRest: true,
  viewMoved: false,
  counting: false,
});

test('the frame clears nothing from the encoder: its first dispatch zeroes what the kernels count', async () => {
  const { device } = fakeDevice();
  let pyramid: GPUBuffer | undefined = buffer('pyramid');
  const partition = (await createGpuPartition(device, 4096, {
    items: buffer('items'),
    flags: buffer('flags'),
    restBits: buffer('rest'),
    slotUsed: { ...buffer('slots'), size: 4 * 300 },
    pyramid: () => pyramid,
  }))!;
  const cleared: unknown[] = [];
  const quiet = {
    clearBuffer: (target: unknown) => void cleared.push(target),
  } as unknown as GPUCommandEncoder;
  partition.beginFrame(quiet, frame(4000));
  assert.deepEqual(cleared, [], 'no counter, rest bit or slot count is cleared outside the pass');
  const { encoder: frameEncoder, calls } = recordingEncoder();
  partition.encode({ pass: frameEncoder.beginComputePass() });
  // 300 slot words outnumber the 125 rest-bit words and the 16 counters: five groups of 64.
  assert.deepEqual(
    calls.map(({ entry, direct }) => [entry, direct]),
    [
      ['clearRows', 5],
      ['projectRows', 63],
      ['classifyRows', 63],
    ],
  );
  // A frame without a pyramid asks no pass.
  pyramid = undefined;
  partition.beginFrame(quiet, frame(4000));
  partition.encode({
    get pass(): GPUComputePassEncoder {
      throw new Error('no pyramid, no dispatch');
    },
  });
  partition.dispose();
});
