import { createGpuPeriodicReadback } from './gpuPeriodicReadback.ts';
import {
  STATE_WORDS,
  ST_HISTORY_OCCLUDERS,
  ST_OCCLUDERS,
  ST_OVERSIZED,
  ST_OVERSIZED_TRIANGLES,
  ST_REJECTED,
  ST_REJECTED_TRIANGLES,
  ST_TESTED,
  ST_TESTED_TRIANGLES,
  ST_WITHDRAWN,
} from './gpuPartitionContract.ts';

/**
 * What a frame decided and counted, and that frame's number.
 *
 * All these numbers are written by the GPU: the CPU samples them only one frame in fifteen, via
 * the periodic readback. They therefore describe a frame earlier than the one that returns them,
 * like `gpuPassMs`, and stay `undefined` until a sample has come back. Nothing is inferred.
 */
export type PartitionCountsFrame = {
  frame: number;
  occluders: number;
  tested: number;
  rejected: number;
  oversized: number;
  testedTriangles: number;
  rejectedTriangles: number;
  oversizedTriangles: number;
  /** Rows the previous image drew: the occluder set before its own pyramid culls it. */
  historyOccluders: number;
  /** Rows drawn last image that last image's pyramid withdrew to the tested half. */
  withdrawn: number;
};

const empty = (): PartitionCountsFrame => ({
  frame: -1,
  occluders: 0,
  tested: 0,
  rejected: 0,
  oversized: 0,
  testedTriangles: 0,
  rejectedTriangles: 0,
  oversizedTriangles: 0,
  historyOccluders: 0,
  withdrawn: 0,
});

/** Periodic sample of partition counters: one copy, one mapping, no wait. */
export function createPartitionCounters(device: GPUDevice) {
  const counted = empty();
  let sampledFrame = -1;
  const reader = createGpuPeriodicReadback((mapped) => {
    const words = new Uint32Array(mapped);
    counted.frame = sampledFrame;
    counted.occluders = words[ST_OCCLUDERS];
    counted.tested = words[ST_TESTED];
    counted.rejected = words[ST_REJECTED];
    counted.oversized = words[ST_OVERSIZED];
    counted.testedTriangles = words[ST_TESTED_TRIANGLES];
    counted.rejectedTriangles = words[ST_REJECTED_TRIANGLES];
    counted.oversizedTriangles = words[ST_OVERSIZED_TRIANGLES];
    counted.historyOccluders = words[ST_HISTORY_OCCLUDERS];
    counted.withdrawn = words[ST_WITHDRAWN];
  });

  /** Sample buffer, made on the first sampled frame and never once per frame. */
  const ensure = () => {
    if (reader.buffer) return true;
    if (typeof device.createBuffer !== 'function') return false;
    try {
      const buffer = device.createBuffer({
        label: 'WG partition counts readback',
        size: STATE_WORDS * 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      if (typeof buffer.mapAsync !== 'function' || typeof buffer.getMappedRange !== 'function') {
        buffer.destroy();
        return false;
      }
      reader.adopt(buffer);
      return true;
    } catch {
      return false;
    }
  };

  return {
    due: (frame: number) => reader.due(frame) && ensure(),
    encodeCopy(encoder: GPUCommandEncoder, state: GPUBuffer, frame: number) {
      if (!reader.buffer) return;
      sampledFrame = frame;
      reader.copy(encoder, state, 0, STATE_WORDS * 4);
      reader.sampled(frame);
    },
    submitted: reader.submitted,
    counts: () => (reader.ready ? counted : undefined),
    dispose: reader.dispose,
  };
}
